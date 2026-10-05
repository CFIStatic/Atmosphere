/**
 * iPhone / Android app shell (Capacitor, apps/mobile). The app appends
 * "AtmosphereFieldCapture" to the web view's user agent, which also applies to
 * this console inside Field Capture's Dashboard iframe. Marks the document so
 * index.css can apply phone-app-only sizing (16px fields, no callouts, tabs
 * that fit). In any browser this does nothing, so desktop and mobile web are
 * unchanged.
 */
export const APP_SHELL_UA = /AtmosphereFieldCapture/;

export function isAppShellUserAgent(ua: string): boolean {
  return APP_SHELL_UA.test(ua);
}

export function initAppShell(): void {
  try {
    const ua = navigator.userAgent || '';
    if (!isAppShellUserAgent(ua)) return;
    const root = document.documentElement;
    root.dataset.appShell = /Android/i.test(ua) ? 'android' : 'ios';
    // Natural phone size: no pinch zoom, no zoom into a focused field.
    const vp = document.querySelector('meta[name="viewport"]');
    vp?.setAttribute(
      'content',
      'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover',
    );
  } catch {
    /* no DOM — nothing to mark */
  }
}

/**
 * True inside the iPhone/Android app: the document is marked by
 * initAppShell, the user agent carries the app marker (this also covers the
 * console inside Field Capture's Dashboard frame), or Capacitor reports a
 * native platform. False in every browser.
 */
export function isInAppShell(): boolean {
  try {
    if (typeof document !== 'undefined' && document.documentElement.dataset.appShell) return true;
    if (typeof navigator !== 'undefined' && isAppShellUserAgent(navigator.userAgent || '')) return true;
    const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    return Boolean(cap?.isNativePlatform?.());
  } catch {
    return false;
  }
}

/**
 * App Store rule 3.1.1: the app never sells anything or points at a way to
 * buy. In the app, plan, credit, seat, and payment screens show this line
 * instead: no link and no price.
 */
export const APP_SHELL_BILLING_NOTE = 'Plans and billing are managed on atmosphereteam.com.';
export const APP_SHELL_SEATS_NOTE = 'Manage seats on atmosphereteam.com.';

/**
 * Sign-up and plans live on the corporate website, outside the app. In the
 * app, "Create an account" opens this page in Safari / the system browser:
 * Capacitor hands any top-level or target=_blank navigation to a host outside
 * server.allowNavigation (atmosphereteam.com is not listed) to the OS.
 */
export const WEBSITE_SIGNUP_URL = 'https://atmosphereteam.com/signup';

/** Purchase prompts the server adds to allowance and seat messages. */
const PURCHASE_SENTENCES = [
  /\s*Upgrade the plan or buy credits to continue\.?/gi,
  /\s*An owner can upgrade the plan or buy credits\.?/gi,
  /,?\s*then pauses unless you buy credits\.?/gi,
  /\s*Add \d+ extra Field Capture seats? at \$[\d,.]+\/mo to continue\.?/gi,
];

/**
 * In the app, drop "upgrade / buy credits / add a seat at $X" sentences from
 * a server message. Browsers get the message unchanged.
 */
export function appShellSafeBillingText(message: string, inApp = isInAppShell()): string {
  if (!inApp || !message) return message;
  let out = message;
  for (const pattern of PURCHASE_SENTENCES) out = out.replace(pattern, (m) => (m.startsWith(',') ? '.' : ''));
  out = out.replace(/\s{2,}/g, ' ').trim();
  return out || APP_SHELL_BILLING_NOTE;
}
