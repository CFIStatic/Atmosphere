/**
 * Progress-share (homeowner job-file) API paths.
 *
 * After exchange, the token leaves the URL and lives in an httpOnly cookie.
 * Empty-token callers must hit `/session…` so Express still matches a segment
 * and `resolveShareToken` can fall back to the cookie — otherwise Ask posts to
 * `/api/progress-share//ask` and the UI shows red "Not found".
 */

export const PROGRESS_SHARE_API_PREFIX = '/api/progress-share';

export function progressShareApiPath(token: string, suffix = ''): string {
  const action = !suffix ? '' : suffix.startsWith('/') ? suffix : `/${suffix}`;
  if (!token.trim()) return `${PROGRESS_SHARE_API_PREFIX}/session${action}`;
  return `${PROGRESS_SHARE_API_PREFIX}/${encodeURIComponent(token.trim())}${action}`;
}
