/**
 * Exchange a guest share token for an httpOnly cookie, then drop it from the
 * URL. Path tokens stay valid (Field Capture / emailed links). This is the
 * office-SPA half of POST /api/job-share/exchange and /api/progress-share/exchange.
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

export const JOB_SHARE_GUEST_PATH = '/guest';
export const PROGRESS_SHARE_GUEST_PATH = '/progress-view';

export async function exchangeShareToken(
  kind: 'job' | 'progress',
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const trimmed = token.trim();
  if (trimmed.length < 8) return false;
  const path =
    kind === 'job' ? '/api/job-share/exchange' : '/api/progress-share/exchange';
  try {
    const res = await fetchImpl(`${API_BASE}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ token: trimmed }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** After a successful exchange, replace the tokenized URL with the cookied guest path. */
export function guestPathAfterExchange(
  kind: 'job' | 'progress',
  search: string,
): string {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  params.delete('token');
  params.delete('share');
  const qs = params.toString();
  const base = kind === 'job' ? JOB_SHARE_GUEST_PATH : PROGRESS_SHARE_GUEST_PATH;
  return qs ? `${base}?${qs}` : base;
}
