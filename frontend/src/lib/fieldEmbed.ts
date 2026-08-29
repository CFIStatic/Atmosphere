/**
 * Field Capture embeds the office console in a phone-width iframe.
 *
 * The standalone Field Capture host cannot navigate away to the desktop
 * office — that leaves the 480px web frame. This helper marks the embed,
 * recognises Field Capture parents, and adopts the phone's session so the
 * iframe does not ask the crew to sign in a second time.
 */

export const FIELD_EMBED_QUERY = 'embed=field';
export const PHONE_SHELL_MAX_PX = 640;
export const PHONE_SHELL_MQ = `(max-width: ${PHONE_SHELL_MAX_PX}px)`;

const FIELD_CAPTURE_HOST = /^field-capture(?:-[a-z0-9]+)*\.up\.railway\.app$/i;
const ADOPT_FLAG = 'atmosphere.fieldEmbed.adopted';

export function isFieldCaptureHost(hostname: string): boolean {
  const host = (hostname || '').replace(/:\d+$/, '');
  if (host === 'localhost' || host === '127.0.0.1') return true;
  return FIELD_CAPTURE_HOST.test(host);
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
    return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('embed') === 'field';
  } catch {
    return false;
  }
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

export function markFieldEmbed(search = typeof window !== 'undefined' ? window.location.search : ''): boolean {
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

export function isPhoneShellViewport(width = typeof window !== 'undefined' ? window.innerWidth : 1024): boolean {
  return width <= PHONE_SHELL_MAX_PX;
}

export function shouldUsePhoneShell(width?: number): boolean {
  return isFieldEmbedMarked() || isPhoneShellViewport(width);
}

async function adoptRefreshToken(refreshToken: string): Promise<boolean> {
  const res = await fetch('/api/auth/refresh', {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  return res.ok;
}

export function listenForFieldSession(): () => void {
  if (typeof window === 'undefined') return () => undefined;

  async function onMessage(event: MessageEvent) {
    const data = event.data as { atmosphere?: string; refreshToken?: unknown } | null;
    if (!data || data.atmosphere !== 'field-session') return;
    if (!isFieldCaptureOrigin(event.origin) && event.origin !== window.location.origin) return;
    if (typeof data.refreshToken !== 'string' || data.refreshToken.length < 8) return;

    try {
      if (sessionStorage.getItem(ADOPT_FLAG) === '1') return;
    } catch {
      /* private mode */
    }

    try {
      const me = await fetch('/api/auth/me', { credentials: 'include', headers: { Accept: 'application/json' } });
      if (me.ok) {
        try { sessionStorage.setItem(ADOPT_FLAG, '1'); } catch { /* private mode */ }
        return;
      }
    } catch {
      /* adopt below */
    }

    const ok = await adoptRefreshToken(data.refreshToken);
    if (!ok) return;
    try {
      sessionStorage.setItem(ADOPT_FLAG, '1');
    } catch {
      /* private mode */
    }
    window.location.reload();
  }

  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}

/** Call once at boot, before React mounts. */
export function initFieldEmbed(): void {
  markFieldEmbed();
  listenForFieldSession();
}
