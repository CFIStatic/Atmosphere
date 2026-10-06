/**
 * ComputerDriver over a Playwright CDP connection. Browserbase hands back a
 * CDP URL; this drives the page with real mouse and keyboard events at the
 * coordinates the model picked, and reads the DOM under a point so the
 * approval gate can classify a click before it happens.
 */
import { createHash } from 'node:crypto';
import type { Browser, BrowserContext, Frame, Locator, Page } from 'playwright-core';
import {
  DESCRIBE_AT_POINT,
  DESCRIBE_FOCUSED,
  DISMISS_OVERLAYS,
  FIND_FILE_INPUT,
  LOCATE_ELEMENT,
  PAGE_FINGERPRINT,
  PAGE_OUTLINE,
  READ_FIELDS,
  READ_SIGNALS,
  RECORDER,
} from '../domScripts.js';
import type {
  ComputerDriver,
  CookieSnapshot,
  DismissedOverlay,
  DownloadedFile,
  ElementTarget,
  FormFieldReading,
  LocatedElement,
  MouseButton,
  PageOutline,
  PageSignals,
  RecordedAction,
  ScreenshotFormat,
  TargetDescriptor,
  TaskFile,
  SignInFill,
  SignInHints,
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

/** Username / email inputs, most specific first. */
const USERNAME_SELECTORS = [
  'input[autocomplete="username"]:visible',
  // Square and Facebook use autocomplete="username webauthn".
  'input[autocomplete~="username"]:visible',
  'input[type="email"]:visible',
  'input[name*="email" i]:visible',
  'input[name*="user" i]:visible',
  'input[name*="login" i]:visible',
  'input[id*="email" i]:visible',
  'input[id*="user" i]:visible',
  'input[id*="login" i]:visible',
  // Google's sign-in names its box "identifier" (id identifierId).
  'input[name="identifier"]:visible',
  'input[id*="identifier" i]:visible',
];
const PASSWORD_SELECTOR = 'input[type="password"]:visible';

async function firstPresent(page: Page, selectors: string[]): Promise<Locator | null> {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count().catch(() => 0)) > 0) return loc;
  }
  return null;
}

/**
 * True for an email box that is not a sign-in field: a newsletter, sign-up or
 * search form (QXO's home page has a "Sign up" email box). Typing the saved
 * username there and pressing its button would submit someone else's form.
 */
async function notASignInField(field: Locator): Promise<boolean> {
  return field
    .evaluate((el) => {
      type El = { getAttribute(n: string): string | null; form?: El | null; querySelector(s: string): El | null; querySelectorAll(s: string): ArrayLike<El>; textContent: string | null };
      const input = el as unknown as El;
      const attrs = ['name', 'id', 'placeholder', 'aria-label', 'class'].map((a) => input.getAttribute(a) ?? '').join(' ').toLowerCase();
      if (/newsletter|subscri|search|promo|coupon|zip/.test(attrs)) return true;
      const form = input.form;
      if (!form || form.querySelector('input[type="password"]')) return false;
      const buttons = Array.from(form.querySelectorAll('button, input[type="submit"]')).map((b) =>
        ((b.textContent ?? '') + ' ' + (b.getAttribute('value') ?? '') + ' ' + (b.getAttribute('aria-label') ?? '')).trim().toLowerCase(),
      );
      const signUpOnly = buttons.length > 0 && buttons.every((t) => /sign ?up|subscribe|join|register|get started|notify|get deals/.test(t) && !/sign ?in|log ?in|next|continue/.test(t));
      return signUpOnly;
    })
    .catch(() => false);
}

/** The first visible username/email box that belongs to a sign-in form. */
async function firstUsernameField(page: Page): Promise<Locator | null> {
  for (const sel of USERNAME_SELECTORS) {
    const all = page.locator(sel);
    const n = Math.min(await all.count().catch(() => 0), 5);
    for (let i = 0; i < n; i += 1) {
      const loc = all.nth(i);
      if (!(await notASignInField(loc))) return loc;
    }
  }
  return null;
}

/**
 * Click the first visible link or button named exactly one of the names (a
 * landing page's "Sign in"). Exact, so "Sign in" never hits "Sign in with
 * Google" and sends the saved password to another account.
 */
export async function openSignInForm(page: Page, names: string[]): Promise<boolean> {
  for (const name of names) {
    for (const role of ['link', 'button'] as const) {
      const loc = page.getByRole(role, { name, exact: true });
      const n = await loc.count().catch(() => 0);
      for (let i = 0; i < Math.min(n, 5); i += 1) {
        const el = loc.nth(i);
        if (await el.isVisible().catch(() => false)) {
          await el.click({ timeout: 5_000 }).catch(() => undefined);
          return true;
        }
      }
    }
  }
  return false;
}

/** Which sign-in fields the page shows now (used by fillSignIn and the readiness check; never types). */
export async function signInFieldsVisible(page: Page): Promise<{ username: boolean; password: boolean }> {
  return {
    username: Boolean(await firstUsernameField(page)),
    password: Boolean(await firstPresent(page, [PASSWORD_SELECTOR])),
  };
}

/** Submit the field's form: its submit button if it has one, else Enter. */
async function submitFrom(page: Page, field: Locator): Promise<void> {
  const clicked = await field
    .evaluate((el) => {
      type Clickable = { click(): void };
      const form = (el as unknown as { form?: { querySelector(s: string): Clickable | null } | null }).form;
      const btn = form?.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    })
    .catch(() => false);
  if (!clicked) await field.press('Enter');
  await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined);
  await page.waitForTimeout(1_500);
}

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
      this.watchDownloads(p);
    });
    for (const p of context.pages()) this.watchDownloads(p);
  }

  private downloaded: DownloadedFile[] = [];

  /** Record downloads by name (and size when the browser exposes it); contents are not read. */
  private watchDownloads(p: Page) {
    p.on('download', (d) => {
      const entry: DownloadedFile = { name: d.suggestedFilename().slice(0, 200), bytes: null, at: Date.now() };
      this.downloaded.push(entry);
      if (this.downloaded.length > 50) this.downloaded.shift();
      // Remote browsers may not expose the file; size is best effort.
      void d
        .createReadStream()
        .then(async (stream) => {
          let n = 0;
          for await (const chunk of stream) n += (chunk as Buffer).length;
          entry.bytes = n;
        })
        .catch(() => undefined);
    });
  }

  async downloads(): Promise<DownloadedFile[]> {
    return this.downloaded.map((d) => ({ ...d }));
  }

  async attachFiles(x: number, y: number, files: TaskFile[]): Promise<'attached' | 'no_file_input'> {
    const page = await this.active();
    const payload = files.map((f) => ({ name: f.name, mimeType: f.mimeType, buffer: f.bytes }));
    const handle = await page.evaluateHandle(`(${FIND_FILE_INPUT})(${Math.round(x)}, ${Math.round(y)})`);
    const input = handle.asElement();
    if (input) {
      await input.setInputFiles(payload);
      return 'attached';
    }
    // A styled button that opens the chooser itself.
    const chooser = await Promise.all([page.waitForEvent('filechooser', { timeout: 4_000 }), page.mouse.click(x, y)])
      .then(([c]) => c)
      .catch(() => null);
    if (!chooser) return 'no_file_input';
    await chooser.setFiles(payload);
    return 'attached';
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
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    } catch (err) {
      // A slow page that already committed is usable; a page that never started is not.
      if (page.url() === 'about:blank' || !page.url()) throw err;
    }
  }

  async pageOutline(): Promise<PageOutline> {
    const page = await this.active();
    const got = (await page.mainFrame().evaluate(`(${PAGE_OUTLINE})()`).catch(() => null)) as PageOutline | null;
    return got ?? { url: page.url(), title: '', headings: [], dialogs: [], elements: [] };
  }

  async locate(target: ElementTarget): Promise<LocatedElement | null> {
    const page = await this.active();
    return (await page
      .mainFrame()
      .evaluate(`(${LOCATE_ELEMENT})(${JSON.stringify(target)})`)
      .catch(() => null)) as LocatedElement | null;
  }

  async pageFingerprint(): Promise<string> {
    const page = await this.active();
    const fp = (await page.mainFrame().evaluate(`(${PAGE_FINGERPRINT})()`).catch(() => null)) as string | null;
    return fp ?? `${page.url()}#?`;
  }

  async dismissOverlays(): Promise<DismissedOverlay[]> {
    const page = await this.active();
    const got = (await page.mainFrame().evaluate(`(${DISMISS_OVERLAYS})()`).catch(() => [])) as DismissedOverlay[];
    if (got.length) await page.waitForTimeout(600);
    return got;
  }

  private recording: RecordedAction[] | null = null;
  private recorderInstalled = false;

  async startRecording(): Promise<void> {
    this.recording = [];
    if (!this.recorderInstalled) {
      this.recorderInstalled = true;
      // The binding only receives descriptors; the server maps any typed value to a slot and drops it.
      await this.context
        .exposeBinding('__atmoRecord', (_source, ev: unknown) => {
          if (!this.recording || !ev || typeof ev !== 'object') return;
          const e = ev as Record<string, unknown>;
          const kind = String(e.kind ?? '');
          if (!['click', 'type', 'press', 'sign_in'].includes(kind)) return;
          this.recording.push({
            kind: kind as RecordedAction['kind'],
            role: typeof e.role === 'string' ? e.role.slice(0, 40) : null,
            name: typeof e.name === 'string' ? e.name.slice(0, 120) : null,
            tag: typeof e.tag === 'string' ? e.tag.slice(0, 20) : null,
            inputType: typeof e.inputType === 'string' ? e.inputType.slice(0, 20) : null,
            key: typeof e.key === 'string' ? e.key.slice(0, 20) : null,
            value: typeof e.value === 'string' ? e.value.slice(0, 500) : null,
            at: Date.now(),
          });
        })
        .catch(() => undefined);
      await this.context.addInitScript(RECORDER).catch(() => undefined);
      this.context.on('page', (p) => this.watchNavigation(p));
      for (const p of this.context.pages()) this.watchNavigation(p);
    }
    for (const p of this.context.pages()) {
      await p.evaluate(RECORDER).catch(() => undefined);
      await p.evaluate('window.__atmoRecording = true').catch(() => undefined);
    }
  }

  private watched = new WeakSet<Page>();
  private watchNavigation(p: Page) {
    if (this.watched.has(p)) return;
    this.watched.add(p);
    p.on('framenavigated', (frame) => {
      if (!this.recording || frame !== p.mainFrame()) return;
      const url = frame.url();
      const last = this.recording[this.recording.length - 1];
      if (last?.kind === 'navigate' && last.url === url) return;
      this.recording.push({ kind: 'navigate', url, at: Date.now() });
    });
  }

  async stopRecording(): Promise<RecordedAction[]> {
    const got = this.recording ?? [];
    this.recording = null;
    for (const p of this.context.pages()) await p.evaluate('window.__atmoRecording = false').catch(() => undefined);
    return got;
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

  async visibleText(): Promise<string> {
    const page = await this.active();
    const text = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
    return text.slice(0, 50_000);
  }

  async pageSignals(): Promise<PageSignals> {
    const page = await this.active();
    const base = (await page.mainFrame().evaluate(`(${READ_SIGNALS})()`).catch(() => null)) as PageSignals | null;
    const signals: PageSignals = {
      url: page.url(),
      hasPasswordField: false,
      hasOneTimeCodeField: false,
      hasCaptcha: false,
      mentionsVerificationCode: false,
      approvalNumber: null,
      visibleOtpCode: null,
      ...(base ?? {}),
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

  async fillSignIn(creds: { username: string; password: string }, hints?: SignInHints): Promise<SignInFill> {
    try {
      const page = await this.active();
      const hostNow = () => {
        try {
          return new URL(page.url()).host.toLowerCase();
        } catch {
          return '';
        }
      };
      const allowed = () => !hints?.allowHost || hints.allowHost(hostNow());
      if (hints?.openWith?.length && !(await firstPresent(page, [PASSWORD_SELECTOR])) && !(await firstUsernameField(page))) {
        // A landing page: open the sign-in form through its own link first.
        if (await openSignInForm(page, hints.openWith)) {
          await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined);
          await page.locator(`${PASSWORD_SELECTOR}, ${USERNAME_SELECTORS.join(', ')}`).first().waitFor({ state: 'visible', timeout: 8_000 }).catch(() => undefined);
        }
      }
      let sentUsername = false;
      for (let round = 0; round < 3; round += 1) {
        const password = await firstPresent(page, [PASSWORD_SELECTOR]);
        let username = await firstUsernameField(page);
        if (password && !username && !sentUsername) {
          // Some pages (Square) draw the password box before the username box.
          await page.locator(USERNAME_SELECTORS.join(', ')).first().waitFor({ state: 'visible', timeout: 3_000 }).catch(() => undefined);
          username = await firstUsernameField(page);
        }
        if (password) {
          // Never type a saved password on a page the login doesn't belong to.
          if (!allowed()) return 'other_site';
          if (username && !sentUsername) await username.fill(creds.username);
          await password.fill(creds.password);
          await submitFrom(page, password);
          return 'submitted';
        }
        if (username && !sentUsername) {
          if (!allowed()) return 'other_site';
          // A username-first page (Microsoft, Google): send it, then wait for the password page.
          await username.fill(creds.username);
          sentUsername = true;
          await submitFrom(page, username);
          await page.locator(PASSWORD_SELECTOR).first().waitFor({ state: 'visible', timeout: 8_000 }).catch(() => undefined);
          continue;
        }
        break;
      }
      return sentUsername ? 'username_only' : 'no_form';
    } catch {
      // Playwright errors can quote the call; never pass one on.
      throw new Error('Could not fill in the sign-in form.');
    }
  }

  async close() {
    // Closing the CDP connection; the provider releases the session itself.
    await this.browser.close().catch(() => undefined);
  }
}
