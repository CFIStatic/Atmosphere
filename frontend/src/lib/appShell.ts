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
    keepDocumentUnscrolled();
  } catch {
    /* no DOM — nothing to mark */
  }
}

/**
 * Phone app: the page itself never scrolls; lists inside it do. When a field
 * is focused, iOS scrolls the document (and even overflow:hidden boxes) to
 * bring it into view, which slid the job Chat up under the status bar inside
 * Field Capture's Dashboard frame. Undo any such scroll right away.
 */
function keepDocumentUnscrolled(): void {
  const reset = () => {
    if (window.scrollY || window.scrollX) window.scrollTo(0, 0);
    const composer = document.activeElement?.closest?.('[data-ask-composer]');
    for (let el = composer?.parentElement ?? null; el && el !== document.body; el = el.parentElement) {
      if (el.scrollTop && getComputedStyle(el).overflowY === 'hidden') el.scrollTop = 0;
    }
  };
  window.addEventListener('scroll', reset, { passive: true });
  window.visualViewport?.addEventListener('resize', reset);
  document.addEventListener('focusin', () => {
    reset();
    window.setTimeout(reset, 60);
    window.setTimeout(reset, 320);
  });
}

/** True inside the phone app (html[data-app-shell] was set by initAppShell). */
export function isAppShellDocument(): boolean {
  try {
    return typeof document !== 'undefined' && Boolean(document.documentElement.dataset.appShell);
  } catch {
    return false;
  }
}
