import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Keeps an open tab from running an old build after a deploy. We check
 * /version.json (no-store) on an interval, when the tab becomes visible, and on
 * route changes. Once a newer build is live, the next route change is done as
 * a full-page load of the destination, so the user lands on the new version
 * instead of asking the server for page files from the old one.
 */

const CHECK_INTERVAL_MS = 5 * 60_000;
const MIN_GAP_MS = 30_000;
const NAV_RELOAD_KEY = 'atm:version-reload-at';
const NAV_RELOAD_GUARD_MS = 60_000;

export const CURRENT_BUILD_ID: string =
  typeof __APP_BUILD_ID__ === 'string' ? __APP_BUILD_ID__ : 'dev';

export async function fetchLiveBuildId(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { buildId?: unknown };
    return typeof body.buildId === 'string' && body.buildId ? body.buildId : null;
  } catch {
    return null;
  }
}

export function isNewerBuild(current: string, live: string | null): boolean {
  return current !== 'dev' && !!live && live !== current;
}

/** Full-page load to `href` unless we just did one (guards a stale-cache loop). */
export function hardNavigate(href: string, now: number = Date.now()): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(NAV_RELOAD_KEY) ?? 0) || 0;
    if (now - last < NAV_RELOAD_GUARD_MS) return false;
    window.sessionStorage.setItem(NAV_RELOAD_KEY, String(now));
  } catch {
    return false;
  }
  window.location.assign(href);
  return true;
}

/**
 * Once a newer build is live, turn the next in-app navigation into a full-page
 * load of its destination. Hooks history.pushState (what the router calls
 * before it renders the next page), so the old build never asks the server
 * for a page file it may no longer have.
 */
export function armFullLoadOnNextNavigation(): void {
  const w = window as Window & { __atmNavArmed?: boolean };
  if (w.__atmNavArmed) return;
  w.__atmNavArmed = true;
  const original = window.history.pushState.bind(window.history);
  window.history.pushState = (data: unknown, unused: string, url?: string | URL | null) => {
    if (url != null) {
      const next = new URL(String(url), window.location.href);
      if (next.origin === window.location.origin && hardNavigate(next.href)) return;
    }
    original(data, unused, url);
  };
}

export function useVersionWatch(): void {
  const location = useLocation();
  const stale = useRef(false);
  const lastCheck = useRef(0);
  const firstRender = useRef(true);

  const check = useRef(async () => {
    if (CURRENT_BUILD_ID === 'dev' || stale.current) return;
    const now = Date.now();
    if (now - lastCheck.current < MIN_GAP_MS) return;
    lastCheck.current = now;
    if (isNewerBuild(CURRENT_BUILD_ID, await fetchLiveBuildId())) {
      stale.current = true;
      armFullLoadOnNextNavigation();
    }
  });

  useEffect(() => {
    if (CURRENT_BUILD_ID === 'dev') return;
    const run = () => void check.current();
    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };
    const id = window.setInterval(run, CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', run);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', run);
    };
  }, []);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    // Route changes are a cheap moment to look; if a new build is live the
    // following navigation becomes a full-page load.
    void check.current();
  }, [location.pathname]);
}

export function VersionWatch(): null {
  useVersionWatch();
  return null;
}
