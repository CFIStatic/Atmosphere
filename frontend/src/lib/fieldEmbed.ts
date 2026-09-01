import { isThemePreference, setThemePreference } from './theme';

/**
 * Field Capture embeds the office console in a phone-width iframe.
 *
 * The standalone Field Capture host cannot navigate away to the desktop
 * office — that leaves the 480px web frame. This helper marks the embed,
 * recognises Field Capture parents, and adopts the phone's session so the
 * iframe does not ask the crew to sign in a second time.
 *
 * One login: Field Capture stores tokens in sessionStorage and posts them
 * here. Cookies often fail in this third-party iframe (SameSite=lax), so we
 * also keep a Bearer copy for /api calls.
 */

export const FIELD_EMBED_QUERY = 'embed=field';
export const PHONE_SHELL_MAX_PX = 640;
export const PHONE_SHELL_MQ = `(max-width: ${PHONE_SHELL_MAX_PX}px)`;

export const FIELD_SESSION = 'field-session';
export const FIELD_SESSION_MISSING = 'field-session-missing';
export const REQUEST_FIELD_SESSION = 'request-field-session';

const FIELD_CAPTURE_HOST = /^field-capture(?:-[a-z0-9]+)*\.up\.railway\.app$/i;
const FIELD_CAPTURE_CUSTOM = /^(?:www\.)?app\.atmosphereteam\.com$/i;
const ACCESS_KEY = 'atmosphere.fieldEmbed.accessToken';
const REFRESH_KEY = 'atmosphere.fieldEmbed.refreshToken';

const sessionWaiters: Array<(ok: boolean) => void> = [];
let navigatingAfterAdopt = false;

export function isFieldCaptureHost(hostname: string): boolean {
  const host = (hostname || '').replace(/:\d+$/, '');
  if (host === 'localhost' || host === '127.0.0.1') return true;
  return FIELD_CAPTURE_HOST.test(host) || FIELD_CAPTURE_CUSTOM.test(host);
}

export function isFieldCaptureOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? isFieldCaptureHost(url.hostname)
      : false;
  } catch {
    return false;
  }
}

export function isFieldEmbedQuery(search: string): boolean {
  try {
    return (
      new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('embed') ===
      'field'
    );
  } catch {
    return false;
  }
}

export function hasFieldEmbedInPath(path: string): boolean {
  const q = path.indexOf('?');
  if (q < 0) return false;
  return isFieldEmbedQuery(path.slice(q));
}

export function withFieldEmbed(path: string): string {
  const raw = path || '/verifier-library';
  const hashIndex = raw.indexOf('#');
  const hash = hashIndex >= 0 ? raw.slice(hashIndex) : '';
  const withoutHash = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
  const qIndex = withoutHash.indexOf('?');
  const pathname = qIndex >= 0 ? withoutHash.slice(0, qIndex) : withoutHash;
  const query = qIndex >= 0 ? withoutHash.slice(qIndex + 1) : '';
  const params = new URLSearchParams(query);
  params.set('embed', 'field');
  return `${pathname}?${params.toString()}${hash}`;
}

export function markFieldEmbed(
  search = typeof window !== 'undefined' ? window.location.search : '',
): boolean {
  if (typeof document === 'undefined') return false;
  if (!isFieldEmbedQuery(search) && document.documentElement.dataset.fieldEmbed !== '1') {
    return false;
  }
  document.documentElement.dataset.fieldEmbed = '1';
  return true;
}

export function isFieldEmbedMarked(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.dataset.fieldEmbed === '1';
}

export function isPhoneShellViewport(
  width = typeof window !== 'undefined' ? window.innerWidth : 1024,
): boolean {
  return width <= PHONE_SHELL_MAX_PX;
}

export function shouldUsePhoneShell(width?: number): boolean {
  return isFieldEmbedMarked() || isPhoneShellViewport(width);
}

export function fieldSessionTokens(data: { refreshToken?: unknown; accessToken?: unknown }): {
  refreshToken: string | null;
  accessToken: string | null;
} {
  const refresh =
    typeof data.refreshToken === 'string' && data.refreshToken.length >= 8
      ? data.refreshToken
      : null;
  const access =
    typeof data.accessToken === 'string' && data.accessToken.length >= 8 ? data.accessToken : null;
  return { refreshToken: refresh, accessToken: access };
}

export function rememberFieldEmbedSession(
  accessToken?: string | null,
  refreshToken?: string | null,
): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    if (accessToken) sessionStorage.setItem(ACCESS_KEY, accessToken);
    if (refreshToken) sessionStorage.setItem(REFRESH_KEY, refreshToken);
  } catch {
    /* private mode */
  }
}

export function fieldEmbedAccessToken(): string | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    return sessionStorage.getItem(ACCESS_KEY);
  } catch {
    return null;
  }
}

export function fieldEmbedRefreshToken(): string | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    return sessionStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

export function clearFieldEmbedSession(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(ACCESS_KEY);
    sessionStorage.removeItem(REFRESH_KEY);
  } catch {
    /* private mode */
  }
}

function isAuthPath(pathname: string): boolean {
  return pathname === '/login' || pathname === '/signup' || pathname === '/forgot-password';
}

export function adoptDestinationFrom(pathname: string, search = ''): string {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (isAuthPath(pathname)) {
    const next = params.get('next');
    const dest =
      next &&
      next.startsWith('/') &&
      !next.startsWith('//') &&
      !next.includes('://') &&
      !next.startsWith('/login') &&
      !next.startsWith('/signup')
        ? next
        : '/verifier-library';
    return withFieldEmbed(dest);
  }
  return withFieldEmbed(`${pathname}${search}`);
}

export function adoptDestination(): string {
  if (typeof window === 'undefined') return withFieldEmbed('/verifier-library');
  return adoptDestinationFrom(window.location.pathname, window.location.search);
}

function notifySessionWaiters(ok: boolean): void {
  const pending = sessionWaiters.splice(0, sessionWaiters.length);
  for (const fn of pending) fn(ok);
}

function parentOrigin(): string {
  try {
    if (typeof document !== 'undefined' && document.referrer) {
      const origin = new URL(document.referrer).origin;
      if (isFieldCaptureOrigin(origin)) return origin;
    }
  } catch {
    /* ignore */
  }
  return '*';
}

export function requestParentFieldSession(): void {
  if (typeof window === 'undefined' || window.parent === window) return;
  window.parent.postMessage({ atmosphere: REQUEST_FIELD_SESSION }, parentOrigin());
}

/** Tell Field Capture to drop its tokens — the phone top bar is hidden on Platform. */
export function postSignOutToFieldCapture(): void {
  if (typeof window === 'undefined' || window.parent === window) return;
  try {
    window.parent.postMessage({ atmosphere: 'sign-out' }, parentOrigin());
  } catch {
    /* ignore */
  }
}

async function adoptRefreshToken(refreshToken: string): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const body = (await res.json().catch(() => null)) as {
      session?: { accessToken?: string; refreshToken?: string };
    } | null;
    rememberFieldEmbedSession(
      body?.session?.accessToken,
      body?.session?.refreshToken || refreshToken,
    );
    return true;
  } catch {
    return false;
  }
}

export async function refreshFieldEmbedSession(): Promise<boolean> {
  const refreshToken = fieldEmbedRefreshToken();
  if (!refreshToken) return false;
  return adoptRefreshToken(refreshToken);
}

async function fieldEmbedSessionIsUsable(): Promise<boolean> {
  const access = fieldEmbedAccessToken();
  if (access) {
    try {
      const res = await fetch('/api/auth/me', {
        credentials: 'include',
        headers: { Accept: 'application/json', Authorization: `Bearer ${access}` },
      });
      if (res.ok) return true;
    } catch {
      /* network — try refresh below */
    }
  }
  if (await refreshFieldEmbedSession()) return true;
  if (access || fieldEmbedRefreshToken()) clearFieldEmbedSession();
  return false;
}

async function adoptFromMessage(data: {
  refreshToken?: unknown;
  accessToken?: unknown;
}): Promise<boolean> {
  const { refreshToken, accessToken } = fieldSessionTokens(data);
  if (!refreshToken && !accessToken) return false;
  rememberFieldEmbedSession(accessToken, refreshToken);
  if (refreshToken) {
    const ok = await adoptRefreshToken(refreshToken);
    if (ok) return true;
  }
  return fieldEmbedSessionIsUsable();
}

function goToAdoptedWorkspace(): void {
  if (typeof window === 'undefined' || navigatingAfterAdopt) return;
  const dest = adoptDestination();
  const here = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (!isAuthPath(window.location.pathname) && withFieldEmbed(here) === dest) return;
  if (!isAuthPath(window.location.pathname)) return;
  navigatingAfterAdopt = true;
  window.location.replace(dest);
}

export function listenForFieldSession(): () => void {
  if (typeof window === 'undefined') return () => undefined;

  async function onMessage(event: MessageEvent) {
    const data = event.data as {
      atmosphere?: string;
      refreshToken?: unknown;
      accessToken?: unknown;
    } | null;
    if (!data || typeof data.atmosphere !== 'string') return;
    if (!isFieldCaptureOrigin(event.origin) && event.origin !== window.location.origin) return;

    if (data.atmosphere === FIELD_SESSION_MISSING) {
      notifySessionWaiters(false);
      return;
    }
    if (data.atmosphere !== FIELD_SESSION) return;

    const adopted = await adoptFromMessage(data);
    notifySessionWaiters(adopted);
    if (adopted) goToAdoptedWorkspace();
  }

  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}

/** Hold Auth restore until Field Capture posts its session (or says it has none). */
export async function waitForParentFieldSession(timeoutMs = 8000): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  // A leftover Bearer is not a session — expiry/revoke must not look like success.
  if (await fieldEmbedSessionIsUsable()) return true;
  if (window.parent === window) return false;

  requestParentFieldSession();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearInterval(poll);
      const idx = sessionWaiters.indexOf(finish);
      if (idx >= 0) sessionWaiters.splice(idx, 1);
      resolve(ok);
    };
    sessionWaiters.push(finish);
    const poll = window.setInterval(() => {
      requestParentFieldSession();
    }, 400);
    window.setTimeout(() => finish(false), timeoutMs);
  });
}

function listenForParentTheme(): void {
  if (typeof window === 'undefined' || window.parent === window) return;
  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as { atmosphere?: string; preference?: unknown } | null;
    if (!data || data.atmosphere !== 'theme') return;
    if (!isFieldCaptureOrigin(event.origin) && event.origin !== window.location.origin) return;
    if (!isThemePreference(data.preference)) return;
    setThemePreference(data.preference);
  });
}

/** Call once at boot, before React mounts. */
export function initFieldEmbed(): void {
  markFieldEmbed();
  listenForFieldSession();
  listenForParentTheme();
}
