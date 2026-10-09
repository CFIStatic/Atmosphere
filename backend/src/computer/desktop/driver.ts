/**
 * ComputerDriver for a Windows desktop, through the desktop agent.
 *
 * The agent loop and approval gate work on screen points and element
 * descriptions, not on web pages, so the same loop drives a desktop app:
 *
 * - Screenshots, clicks and keys go to the agent, in the same 1280×800
 *   space as the cloud browser (the agent scales to the real screen).
 * - What sits under a point comes from Windows UI Automation (control type,
 *   name, password flag), so gate.ts classifies a desktop "Upload" or
 *   "Send" button exactly like a web one.
 * - "URL": a desktop app reads as app://<app id>/. While an app's own
 *   sign-in window is up, the driver reports that app's sign-in web address
 *   (e.g. identity.xactware.com), so only the saved login for that site can
 *   be typed into it. A browser window on the desktop reports its address.
 *
 * Verification codes are never typed by Computer; the person enters them in
 * the live view, the same as on the web.
 */
import { SIGN_IN_ERROR } from '../domScripts.js';
import type {
  ComputerDriver,
  CookieSnapshot,
  FormFieldReading,
  MouseButton,
  PageSignals,
  ScreenshotFormat,
  SignInFill,
  SignInHints,
  TargetDescriptor,
} from '../types.js';
import { DESKTOP_APPS, desktopAppById, desktopAppForUrl, type DesktopApp } from './config.js';
import type { DesktopAgentClient } from './agentClient.js';

/** What the agent says is in front. */
export interface AgentWindow {
  kind: 'app' | 'browser' | 'none';
  /** App id from the agent's own app list (e.g. "xactimate"). */
  app?: string | null;
  title?: string | null;
  /** Address bar, for a browser window. */
  url?: string | null;
  /** The front window is the app's sign-in window. */
  signIn?: boolean;
}

interface AgentSignals {
  text?: string;
  hasPasswordField?: boolean;
  hasOneTimeCodeField?: boolean;
}

const VERIFY_TALK = /\b(verification code|security code|one-time (pass)?code|enter the code|two-step|2-step|two-factor|authenticator app|multi-factor)\b/i;
const NUMBER_TALK = /\b(approve|number matching|enter (?:this|the) number|are you trying to sign in|authenticator)\b/i;

/** MFA hints from a window's visible text (same rules as web pages). */
export function signalsFromText(text: string): Pick<PageSignals, 'mentionsVerificationCode' | 'approvalNumber' | 'visibleOtpCode' | 'signInError'> {
  const t = text.slice(0, 20_000);
  const mentionsVerificationCode = VERIFY_TALK.test(t);
  let approvalNumber: string | null = null;
  if (NUMBER_TALK.test(t)) {
    const m =
      t.match(/\b(?:approve|enter|number(?:\s+is)?|matching)[^\d]{0,40}\b(\d{2,3})\b/i) ??
      t.match(/\b(\d{2,3})\b[^\d]{0,40}(?:on your (?:phone|device)|in (?:your )?authenticator|to (?:sign in|continue|approve))/i);
    if (m) approvalNumber = m[1];
  }
  let visibleOtpCode: string | null = null;
  if (mentionsVerificationCode || /\b(your code|code is|verification code[:\s])/i.test(t)) {
    const m = t.match(/\b(?:code(?:\s+is)?|verification code)[:\s]+(\d{4,8})\b/i);
    if (m && m[1] !== approvalNumber) visibleOtpCode = m[1];
  }
  const errLine = t
    .split(/\n+/)
    .map((l) => l.trim())
    .find((l) => l && l.length <= 300 && SIGN_IN_ERROR.test(l));
  return { mentionsVerificationCode, approvalNumber, visibleOtpCode, signInError: errLine ? errLine.slice(0, 160) : null };
}

function str(v: unknown, max = 300): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function strOrNull(v: unknown, max = 300): string | null {
  return typeof v === 'string' && v ? v.slice(0, max) : null;
}

/** Agent output → TargetDescriptor, with every field forced to the right type. */
export function toTarget(raw: unknown): TargetDescriptor | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const b = (k: string) => r[k] === true;
  return {
    tag: str(r.tag, 40) || 'control',
    type: strOrNull(r.type, 40),
    role: strOrNull(r.role, 40),
    label: str(r.label),
    href: null,
    inForm: b('inForm'),
    formAction: null,
    isFileInput: false,
    isPassword: b('isPassword'),
    isOneTimeCode: b('isOneTimeCode'),
    isCheckbox: b('isCheckbox'),
    isTextEntry: b('isTextEntry'),
    isTextarea: b('isTextarea'),
    inCaptcha: false,
    frameSrc: null,
  };
}

export class DesktopDriver implements ComputerDriver {
  /** The desktop app this task opened last (for its sign-in address). */
  private app: DesktopApp | null = null;

  constructor(
    private readonly agent: DesktopAgentClient,
    readonly viewport: { width: number; height: number },
  ) {}

  async screenshot(format: ScreenshotFormat = 'png'): Promise<string> {
    const out = await this.agent.call<{ image?: string }>('/screenshot', { format, width: this.viewport.width, height: this.viewport.height });
    if (!out.image) throw new Error('The desktop sent no screenshot');
    return out.image;
  }

  private input(body: Record<string, unknown>): Promise<unknown> {
    return this.agent.call('/input', body);
  }

  async click(x: number, y: number, opts: { button?: MouseButton; clickCount?: number; modifiers?: string[] } = {}): Promise<void> {
    await this.input({ action: 'click', x, y, button: opts.button ?? 'left', clickCount: opts.clickCount ?? 1, modifiers: opts.modifiers ?? [] });
  }

  async move(x: number, y: number): Promise<void> {
    await this.input({ action: 'move', x, y });
  }

  async mouseDown(button: MouseButton = 'left'): Promise<void> {
    await this.input({ action: 'down', button });
  }

  async mouseUp(button: MouseButton = 'left'): Promise<void> {
    await this.input({ action: 'up', button });
  }

  async drag(from: [number, number], to: [number, number]): Promise<void> {
    await this.input({ action: 'drag', from, to });
  }

  async type(text: string): Promise<void> {
    await this.input({ action: 'type', text });
  }

  async key(combo: string, repeat = 1): Promise<void> {
    await this.input({ action: 'key', combo, repeat: Math.max(1, Math.min(50, repeat)) });
  }

  async scroll(x: number, y: number, direction: 'up' | 'down' | 'left' | 'right', amount: number): Promise<void> {
    await this.input({ action: 'scroll', x, y, direction, amount });
  }

  /**
   * app://<id> opens (or brings forward) that desktop app. A web address on
   * the current app's sign-in site brings the app's own sign-in window
   * forward instead of opening a browser. Any other https address opens in
   * the desktop's browser.
   */
  async navigate(url: string): Promise<void> {
    const app = desktopAppForUrl(url);
    if (app) {
      await this.agent.call('/launch', { app: app.id }, 120_000);
      this.app = app;
      return;
    }
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      throw new Error('Not a web address or desktop app');
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only web addresses and desktop apps can be opened');
    const signInApp = this.app ?? DESKTOP_APPS.find((a) => a.signInUrl && new URL(a.signInUrl).hostname === u.hostname) ?? null;
    if (signInApp?.signInUrl && new URL(signInApp.signInUrl).hostname === u.hostname) {
      await this.agent.call('/launch', { app: signInApp.id }, 120_000);
      this.app = signInApp;
      return;
    }
    await this.agent.call('/open-url', { url: u.toString() }, 60_000);
  }

  async window(): Promise<AgentWindow> {
    return this.agent.call<AgentWindow>('/window');
  }

  async currentUrl(): Promise<string> {
    const w = await this.window();
    if (w.kind === 'browser' && w.url) return w.url;
    if (w.kind === 'app') {
      const app = desktopAppById(w.app ?? null);
      if (app) {
        this.app = app;
        if (w.signIn && app.signInUrl) return app.signInUrl;
        return `app://${app.id}/`;
      }
      return 'app://desktop/';
    }
    return 'app://desktop/';
  }

  async describeTarget(x: number, y: number): Promise<TargetDescriptor | null> {
    return toTarget(await this.agent.call('/element-at', { x, y }));
  }

  async focusedElement(): Promise<TargetDescriptor | null> {
    return toTarget(await this.agent.call('/focused'));
  }

  async readFormFields(): Promise<FormFieldReading[]> {
    const out = await this.agent.call<{ fields?: unknown[] }>('/fields');
    return (out.fields ?? []).slice(0, 200).flatMap((f) => {
      if (!f || typeof f !== 'object') return [];
      const r = f as Record<string, unknown>;
      return [{ label: str(r.label), name: strOrNull(r.name, 120), type: str(r.type, 40) || 'text', value: str(r.value, 1000) }];
    });
  }

  async visibleText(): Promise<string> {
    const out = await this.agent.call<{ text?: string }>('/text');
    return str(out.text, 20_000);
  }

  async pageSignals(): Promise<PageSignals> {
    const [url, raw] = await Promise.all([this.currentUrl(), this.agent.call<AgentSignals>('/signals')]);
    const fromText = signalsFromText(str(raw.text, 20_000));
    return {
      url,
      hasPasswordField: raw.hasPasswordField === true,
      hasOneTimeCodeField: raw.hasOneTimeCodeField === true,
      // No captcha solving on the desktop either; a captcha shows up as a
      // browser page the agent can't read past, and the person handles it.
      hasCaptcha: false,
      ...fromText,
    };
  }

  async cursorPosition(): Promise<[number, number]> {
    const out = await this.agent.call<{ x?: number; y?: number }>('/cursor');
    return [Number(out.x) || 0, Number(out.y) || 0];
  }

  /** Desktop apps keep their own sign-in; there are no cookies to compare. */
  async cookieSnapshot(): Promise<CookieSnapshot> {
    return {};
  }

  async clearSiteData(_domains: string[]): Promise<number> {
    return 0;
  }

  /**
   * Type a saved login into the front window's sign-in form. The address
   * check runs here, right before the agent is given the password.
   */
  async fillSignIn(creds: { username: string; password: string }, hints: SignInHints = {}): Promise<SignInFill> {
    const url = await this.currentUrl();
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      host = '';
    }
    if (url.startsWith('app://')) return 'no_form';
    if (hints.allowHost && !hints.allowHost(host)) return 'other_site';
    const out = await this.agent.call<{ result?: string }>('/signin', { username: creds.username, password: creds.password }, 60_000);
    const result = out.result;
    return result === 'submitted' || result === 'username_only' || result === 'no_form' ? result : 'no_form';
  }

  async close(): Promise<void> {
    // The provider ends the session; nothing is held open here.
  }
}
