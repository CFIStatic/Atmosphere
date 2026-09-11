/**
 * Sold first-run path: new org → billing → first job → film in Field Capture.
 * Keep helpers here so signup, intake, and empty states stay aligned.
 */

/** Where Global Admins land after billing — Start a job, not an empty dashboard. */
export const FIRST_RUN_HOME = '/intake';

/** Public Field Capture web host (same login as Platform). */
export const FIELD_CAPTURE_WEB_ORIGIN = 'https://app.atmosphereteam.com';

const GENERIC_POST_AUTH = new Set([
  '/',
  '/verifier-library',
  '/jobs',
  '/onboarding',
  '/signup',
]);

/**
 * After workspace + billing, prefer Start a job unless the user already had a
 * specific deep link (job file, settings section, etc.).
 */
export function firstRunDestination(
  requested: string | null | undefined,
  platformHome: string,
): string {
  const next = (requested ?? '').trim();
  if (!next) return FIRST_RUN_HOME;
  if (next === platformHome) return FIRST_RUN_HOME;
  const pathOnly = next.split(/[?#]/)[0] ?? next;
  if (GENERIC_POST_AUTH.has(pathOnly) || pathOnly.startsWith('/signup')) {
    return FIRST_RUN_HOME;
  }
  return next;
}

/** Absolute Field Capture URL for a relative invite path or bare host. */
export function fieldCaptureOpenUrl(path?: string | null): string {
  const raw = (path ?? '').trim();
  if (!raw) return FIELD_CAPTURE_WEB_ORIGIN;
  if (/^https?:\/\//i.test(raw)) return raw;
  try {
    const qs = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : '';
    const token = new URLSearchParams(qs).get('token');
    if (token) {
      return fieldCaptureInviteOpenUrl(token, new URLSearchParams(qs).get('email'));
    }
  } catch {
    /* fall through */
  }
  if (raw.startsWith('/')) {
    return `${FIELD_CAPTURE_WEB_ORIGIN}${raw.replace(/^\/fieldcapture\/?/, '/')}`;
  }
  return FIELD_CAPTURE_WEB_ORIGIN;
}

/** After capture-invite signup: classic Field Capture for that token, or the app host. */
export function captureAfterSignup(token?: string | null, email?: string | null): string {
  const invite = (token ?? '').trim();
  return invite ? fieldCaptureInviteOpenUrl(invite, email) : FIELD_CAPTURE_WEB_ORIGIN;
}

/** Classic Field Capture invite: token + email + account gate. */
export function fieldCaptureInviteOpenUrl(token: string, email?: string | null): string {
  const params = new URLSearchParams();
  params.set('token', token.trim());
  const address = email?.trim().toLowerCase();
  if (address) params.set('email', address);
  params.set('account', '1');
  return `${FIELD_CAPTURE_WEB_ORIGIN}/?${params.toString()}`;
}
