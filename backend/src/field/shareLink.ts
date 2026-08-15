/**
 * Job-share invite links for Field Capture.
 *
 * Email still opens the web job page. The iPhone app also accepts the same
 * token via atmosphere-field://share?token=… or a pasted /shared/… URL.
 */

export function extractShareToken(raw: string): string | null {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    const fromQuery = url.searchParams.get('token') || url.searchParams.get('share');
    if (fromQuery && fromQuery.length >= 6) return fromQuery;

    const parts = url.pathname.split('/').filter(Boolean);
    const sharedAt = parts.findIndex((part) => part.toLowerCase() === 'shared');
    if (sharedAt >= 0 && parts[sharedAt + 1]) {
      return decodeURIComponent(parts[sharedAt + 1]);
    }

    const host = (url.hostname || url.host || '').toLowerCase();
    if (url.protocol === 'atmosphere-field:') {
      if (host === 'share' || host === 'shared') {
        return fromQuery || (parts[0] ? decodeURIComponent(parts[0]) : null);
      }
    }
  } catch {
    /* not a URL — treat as a raw token */
  }

  if (/^[A-Za-z0-9+/=_-]{8,200}$/.test(trimmed)) return trimmed;
  return null;
}

export function nativeShareURL(token: string): string {
  return `atmosphere-field://share?token=${encodeURIComponent(token)}`;
}

export function tokenFromSharePath(path: string): string | null {
  const trimmed = String(path ?? '').trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('atmosphere-field:')) {
    return extractShareToken(trimmed);
  }
  return extractShareToken(`https://app.local${trimmed.startsWith('/') ? trimmed : `/${trimmed}`}`);
}
