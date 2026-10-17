/**
 * First-run path: create the account → plan and card → the Dashboard.
 * Keep helpers here so signup and the billing gate agree.
 */

import { DASHBOARD_HOME } from './platforms';

/** Where Global Admins land after billing (or a comped setup): the Dashboard. */
export const FIRST_RUN_HOME = DASHBOARD_HOME;

/** Public Field Capture web host (same login as Platform). */
export const FIELD_CAPTURE_WEB_ORIGIN = 'https://app.atmosphereteam.com';

/**
 * Retired first-job / first-evidence page. Old links and bookmarks redirect
 * to plan and card; it counts as a generic landing for checkout returns.
 */
export const LEGACY_FIRST_RUN_WELCOME = '/welcome';

/** Homes that are not a specific deep link: they all resolve to the Dashboard. */
const GENERIC_POST_AUTH = new Set([
  '/',
  '/verifier-library',
  '/jobs',
  '/onboarding',
  '/signup',
  '/intake',
  '/field',
  LEGACY_FIRST_RUN_WELCOME,
]);

/**
 * After workspace + billing, open the Dashboard. A specific deep link (a job
 * file, a settings section) still wins.
 */
export function firstRunDestination(requested: string | null | undefined, platformHome: string): string {
  const next = (requested ?? '').trim();
  if (!isGenericPostAuth(next, platformHome)) return next;
  return FIRST_RUN_HOME;
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

/** Billing step URL. Stripe checkout returns to ?step=2 as before. */
export function billingStepHref(next: string | null | undefined): string {
  const target = (next ?? '').trim();
  return target ? `/signup?step=2&next=${encodeURIComponent(target)}` : '/signup?step=2';
}

/** Where an unpaid workspace goes when it opens the office: plan and card. */
export function unpaidWorkspaceTarget(returnPath: string): string {
  return billingStepHref(returnPath);
}

/** Dashboard, Start a job, signup, and other homes that are not a job file or settings link. */
function isGenericPostAuth(path: string, platformHome?: string): boolean {
  const next = path.trim();
  if (!next) return true;
  if (platformHome && next === platformHome) return true;
  const pathOnly = next.split(/[?#]/)[0] ?? next;
  return GENERIC_POST_AUTH.has(pathOnly) || pathOnly.startsWith('/signup');
}
