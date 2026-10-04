/**
 * ComputerDriver over a Playwright CDP connection. Browserbase hands back a
 * CDP URL; this drives the page with real mouse and keyboard events at the
 * coordinates the model picked, and reads the DOM under a point so the
 * approval gate can classify a click before it happens.
 */
import { createHash } from 'node:crypto';
import type { Browser, BrowserContext, Frame, Page } from 'playwright-core';
import { DESCRIBE_AT_POINT, DESCRIBE_FOCUSED, READ_FIELDS, READ_SIGNALS } from '../domScripts.js';
import type {
  ComputerDriver,
  CookieSnapshot,
  FormFieldReading,
  MouseButton,
  PageSignals,
  ScreenshotFormat,
  TargetDescriptor,
} from '../types.js';

/** xdotool names (what computer use emits) → Playwright key names. */
const KEY_MAP: Record<string, string> = {
  return: 'Enter',
  enter: 'Enter',
  kp_enter: 'Enter',
  tab: 'Tab',
  escape: 'Escape',
  esc: 'Escape',
  backspace: 'Backspace',
  delete: 'Delete',
  space: ' ',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  page_up: 'PageUp',
  page_down: 'PageDown',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  home: 'Home',
  end: 'End',
  insert: 'Insert',
  ctrl: 'Control',
  control: 'Control',
  alt: 'Alt',
  shift: 'Shift',
  super: 'Meta',
  cmd: 'Meta',
  meta: 'Meta',
  win: 'Meta',
};

export function toPlaywrightKey(combo: string): string {
  return combo
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const mapped = KEY_MAP[part.toLowerCase()];
      if (mapped) return mapped;
      if (/^f\d{1,2}$/i.test(part)) return part.toUpperCase();
      return part.length === 1 ? part : part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join('+');
}

type RawDescriptor = TargetDescriptor & { frameRect: { x: number; y: number } | null };

function strip(raw: RawDescriptor | null): TargetDescriptor | null {
  if (!raw) return null;
  const { frameRect: _frameRect, ...rest } = raw;
  return rest;
}

export class PlaywrightDriver implements ComputerDriver {
  readonly viewport: { width: number; height: number };
  private page: Page;
  private cursor: [number, number] = [0, 0];

  constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    page: Page,
    viewport: { width: number; height: number },
  ) {
    this.page = page;
    this.viewport = viewport;
    // Follow new tabs (target=_blank links, popups) so the model sees them.
    context.on('page', (p) => {
      this.page = p;
    });
  }

  private async active(): Promise<Page> {
    if (this.page.isClosed()) {
      const open = this.context.pages().filter((p) => !p.isClosed());
      if (open.length) this.page = open[open.length - 1];
      else this.page = await this.context.newPage();
    }
    return this.page;
  }

  async screenshot(format: ScreenshotFormat = 'png'): Promise<string> {
    const page = await this.active();
    const buf = await page.screenshot(format === 'jpeg' ? { type: 'jpeg', quality: 60 } : { type: 'png' });
    return buf.toString('base64');
  }

  async click(x: number, y: number, opts?: { button?: MouseButton; clickCount?: number; modifiers?: string[] }) {
    const page = await this.active();
    const mods = (opts?.modifiers ?? []).map((m) => toPlaywrightKey(m));
    for (const m of mods) await page.keyboard.down(m);
    try {
      await page.mouse.click(x, y, { button: opts?.button ?? 'left', clickCount: opts?.clickCount ?? 1 });
    } finally {
      for (const m of mods.reverse()) await page.keyboard.up(m);
    }
    this.cursor = [x, y];
  }

  async move(x: number, y: number) {
    await (await this.active()).mouse.move(x, y);
    this.cursor = [x, y];
  }

  async mouseDown(button: MouseButton = 'left') {
    await (await this.active()).mouse.down({ button });
  }

  async mouseUp(button: MouseButton = 'left') {
    await (await this.active()).mouse.up({ button });
  }

  async drag(from: [number, number], to: [number, number]) {
    const page = await this.active();
    await page.mouse.move(from[0], from[1]);
    await page.mouse.down();
    await page.mouse.move(to[0], to[1], { steps: 12 });
    await page.mouse.up();
    this.cursor = to;
  }

  async type(text: string) {
    await (await this.active()).keyboard.type(text, { delay: 12 });
  }

  async key(combo: string, repeat = 1) {
    const page = await this.active();
    const key = toPlaywrightKey(combo);
    for (let i = 0; i < Math.max(1, Math.min(repeat, 50)); i += 1) await page.keyboard.press(key);
  }

  async scroll(x: number, y: number, direction: 'up' | 'down' | 'left' | 'right', amount: number) {
    const page = await this.active();
    await page.mouse.move(x, y);
    const px = Math.max(1, Math.min(amount, 30)) * 100;
    const dx = direction === 'left' ? -px : direction === 'right' ? px : 0;
    const dy = direction === 'up' ? -px : direction === 'down' ? px : 0;
    await page.mouse.wheel(dx, dy);
    this.cursor = [x, y];
  }

  async navigate(url: string) {
    const page = await this.active();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  }

  async currentUrl() {
    return (await this.active()).url();
  }

  async describeTarget(x: number, y: number): Promise<TargetDescriptor | null> {
    const page = await this.active();
    let frame: Frame = page.mainFrame();
    let px = x;
    let py = y;
    let outer: RawDescriptor | null = null;
    for (let depth = 0; depth < 3; depth += 1) {
      const raw = (await frame
        .evaluate(`(${DESCRIBE_AT_POINT})(${JSON.stringify({ x: px, y: py })})`)
        .catch(() => null)) as RawDescriptor | null;
      if (!raw) return strip(outer);
      if (!raw.frameRect) {
        if (outer) {
          return strip({ ...raw, inCaptcha: raw.inCaptcha || outer.inCaptcha, frameSrc: outer.frameSrc });
        }
        return strip(raw);
      }
      // The point is over an iframe: look inside it (cross-origin works over CDP).
      outer = outer ? { ...raw, inCaptcha: raw.inCaptcha || outer.inCaptcha } : raw;
      const child = frame.childFrames().find((f) => raw.frameSrc && f.url() === raw.frameSrc) ?? null;
      if (!child) return strip(outer);
      px -= raw.frameRect.x;
      py -= raw.frameRect.y;
      frame = child;
    }
    return strip(outer);
  }

  async focusedElement(): Promise<TargetDescriptor | null> {
    const page = await this.active();
    for (const frame of [page.mainFrame(), ...page.frames().filter((f) => f !== page.mainFrame())]) {
      const raw = (await frame.evaluate(`(${DESCRIBE_FOCUSED})()`).catch(() => null)) as RawDescriptor | null;
      if (raw && raw.tag !== 'iframe') return strip(raw);
    }
    return null;
  }

  async readFormFields(): Promise<FormFieldReading[]> {
    const page = await this.active();
    const rows: FormFieldReading[] = [];
    for (const frame of page.frames()) {
      const got = (await frame.evaluate(`(${READ_FIELDS})()`).catch(() => [])) as FormFieldReading[];
      rows.push(...got);
      if (rows.length >= 60) break;
    }
    return rows.slice(0, 60);
  }

  async pageSignals(): Promise<PageSignals> {
    const page = await this.active();
    const base = (await page.mainFrame().evaluate(`(${READ_SIGNALS})()`).catch(() => null)) as PageSignals | null;
    const signals: PageSignals = base ?? {
      url: page.url(),
      hasPasswordField: false,
      hasOneTimeCodeField: false,
      hasCaptcha: false,
      mentionsVerificationCode: false,
    };
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      if (/recaptcha|hcaptcha|challenges\.cloudflare\.com|turnstile|arkoselabs|funcaptcha/i.test(frame.url())) {
        signals.hasCaptcha = true;
      }
    }
    return signals;
  }

  async cursorPosition(): Promise<[number, number]> {
    return this.cursor;
  }

  async cookieSnapshot(): Promise<CookieSnapshot> {
    const out: CookieSnapshot = {};
    for (const c of await this.context.cookies()) {
      const print = `${c.name}|${createHash('sha256').update(c.value).digest('hex').slice(0, 16)}|${Math.round(c.expires)}`;
      (out[c.domain] ??= []).push(print);
    }
    return out;
  }

  async clearSiteData(domains: string[]): Promise<number> {
    const wanted = new Set(domains);
    const before = (await this.context.cookies()).filter((c) => wanted.has(c.domain)).length;
    for (const domain of wanted) {
      await this.context.clearCookies({ domain });
      // localStorage / IndexedDB for that origin, so an app-held token goes too.
      const origin = `https://${domain.replace(/^\./, '')}`;
      try {
        const page = await this.active();
        const cdp = await this.context.newCDPSession(page);
        await cdp.send('Storage.clearDataForOrigin', {
          origin,
          storageTypes: 'local_storage,indexeddb,websql,cache_storage,service_workers',
        });
        await cdp.detach().catch(() => undefined);
      } catch {
        /* storage clearing is best effort; cookies are what keep a sign-in */
      }
    }
    const after = (await this.context.cookies()).filter((c) => wanted.has(c.domain)).length;
    return Math.max(0, before - after);
  }

  async close() {
    // Closing the CDP connection; the provider releases the session itself.
    await this.browser.close().catch(() => undefined);
  }
}
