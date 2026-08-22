/**
 * Job-share invite URLs.
 *
 * Legacy `job_parties.access_token` values are standard base64 and can contain
 * `/`. Those links must still open the invited job (scope + film), not the
 * office jobs dashboard — `/shared/:token` only matches one path segment, so
 * the splat after `:token` is part of the credential.
 */

export const JOB_SHARE_PAGE_ROUTE = '/shared/:token/*';
export const JOB_SHARE_API_PREFIX = '/api/job-share';

export function jobSharePagePath(token: string, email?: string | null): string {
  const trimmed = token.trim();
  const path = `/shared/${trimmed}`;
  const address = email?.trim();
  if (!address) return path;
  return `${path}?email=${encodeURIComponent(address)}`;
}

export function jobShareApiPath(token: string, suffix = ''): string {
  const action = !suffix ? '' : suffix.startsWith('/') ? suffix : `/${suffix}`;
  return `${JOB_SHARE_API_PREFIX}/${encodeURIComponent(token)}${action}`;
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
