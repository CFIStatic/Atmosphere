import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/**
 * After a deploy, the hashed page chunks the open tab knows about are gone from
 * the server. Clicking into a page that hasn't loaded yet (e.g. Logins) then
 * rejects the dynamic import; with no error boundary React unmounted the whole
 * app and left a blank screen until a manual refresh. These helpers detect that
 * case and reload once to pick up the new build, with a guard against loops.
 */

const RELOAD_KEY = 'atm:chunk-reload-at';
/** Don't auto-reload again within this window; show the error UI instead. */
const RELOAD_GUARD_MS = 30_000;

export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const name = (error as { name?: string }).name ?? '';
  const message = String((error as { message?: string }).message ?? error);
  return (
    name === 'ChunkLoadError' ||
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /Unable to preload CSS/i.test(message) ||
    /Loading (CSS )?chunk [\w-]+ failed/i.test(message) ||
    /'text\/html' is not a valid JavaScript MIME type/i.test(message)
  );
}

function readLastReload(): number {
  try {
    return Number(window.sessionStorage.getItem(RELOAD_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

/**
 * Reload the page once to fetch the latest build. Returns false (and does
 * nothing) if we already reloaded for this reason very recently, so a truly
 * broken chunk shows the error UI instead of looping.
 */
export function reloadOnceForChunkError(now: number = Date.now()): boolean {
  if (typeof window === 'undefined') return false;
  if (now - readLastReload() < RELOAD_GUARD_MS) return false;
  try {
    window.sessionStorage.setItem(RELOAD_KEY, String(now));
  } catch {
    // Without storage we can't guard against a loop; don't auto-reload.
    return false;
  }
  window.location.reload();
  return true;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * React.lazy with one quick retry (covers a network blip). If the chunk is
 * still missing it's a stale build: reload once. Otherwise rethrow so the
 * nearest RouteErrorBoundary shows a retry screen.
 */
export function lazyWithRetry<T extends ComponentType<any>>( // eslint-disable-line @typescript-eslint/no-explicit-any
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      return await factory();
    } catch (first) {
      if (!isChunkLoadError(first)) throw first;
      await sleep(400);
      try {
        return await factory();
      } catch (second) {
        if (isChunkLoadError(second) && reloadOnceForChunkError()) {
          // Keep suspending until the reload replaces the page.
          return new Promise<{ default: T }>(() => {});
        }
        throw second;
      }
    }
  });
}

/** Vite fires this when a modulepreload / CSS preload for a chunk fails. */
export function installChunkErrorReload(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadOnceForChunkError()) event.preventDefault();
  });
}
