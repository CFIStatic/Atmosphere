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
      return `${FIELD_CAPTURE_WEB_ORIGIN}/?token=${encodeURIComponent(token)}`;
    }
  } catch {
    /* fall through */
  }
  if (raw.startsWith('/')) {
    return `${FIELD_CAPTURE_WEB_ORIGIN}${raw.replace(/^\/fieldcapture\/?/, '/')}`;
  }
  return FIELD_CAPTURE_WEB_ORIGIN;
}
