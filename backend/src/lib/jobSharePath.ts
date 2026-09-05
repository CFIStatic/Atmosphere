/**
 * Job-share invite URLs.
 *
 * `job_parties.access_token` used to default to
 * `encode(gen_random_bytes(24), 'base64')`. Standard base64 includes `/` and
 * `+`. A live invite looked like:
 *
 *   /shared/06mK2/nSHxdzmgX4Nd0R0Bow19Bb2gLG
 *
 * The SPA route was `/shared/:token` (one segment) and the catch-all sent a
 * signed-in office user to `/dashboard` — their org jobs list — instead of
 * the invited job. The same split broke `/api/job-share/:token`.
 *
 * Page routes now keep every remaining segment; API routes match the token
 * with a greedy capture so `/` inside a legacy token is still the token.
 */

export const JOB_SHARE_PAGE_PREFIX = '/shared';
export const JOB_SHARE_API_PREFIX = '/api/job-share';

export const JOB_SHARE_ACTIONS = [
  '/proof/upload-url',
  '/proof/upload-complete',
  '/capture-guide',
  '/proof',
  '/accept',
  '/ask',
] as const;

export type JobShareAction = (typeof JOB_SHARE_ACTIONS)[number] | '';

export function jobSharePagePath(token: string, email?: string | null): string {
  const trimmed = token.trim();
  const path = `${JOB_SHARE_PAGE_PREFIX}/${trimmed}`;
  const address = email?.trim();
  if (!address) return path;
  return `${path}?email=${encodeURIComponent(address)}`;
}

export function jobShareApiPath(token: string, action: JobShareAction | string = ''): string {
  const suffix = !action ? '' : action.startsWith('/') ? action : `/${action}`;
  return `${JOB_SHARE_API_PREFIX}/${encodeURIComponent(token)}${suffix}`;
}

/** Rebuild the invite token from `/shared/:token` plus an optional splat. */
export function jobShareTokenFromRoute(params: {
  token?: string;
  '*'?: string;
}): string {
  const parts = [params.token, params['*']].filter((part): part is string => Boolean(part));
  const joined = parts.join('/');
  try {
    return decodeURIComponent(joined);
  } catch {
    return joined;
  }
}

/** Express path for a job-share action; group 1 is the full token. */
export function jobShareActionPattern(action: JobShareAction | string = ''): RegExp {
  if (!action) return /^\/(.+)$/;
  const normalized = action.startsWith('/') ? action : `/${action}`;
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^/(.+)${escaped}$`);
}

export function readJobShareToken(params: Record<string, string | undefined>): string {
  const raw = params['0'] ?? params.token ?? '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
