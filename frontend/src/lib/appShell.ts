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
