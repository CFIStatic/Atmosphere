/**
 * Sold first-run path, value before payment: create the account → name the
 * first job → record it in Field Capture (field) or see sample evidence
 * (office) → only then plan and card → invites from the job file.
 * Keep helpers here so signup, the welcome page, and the billing gate agree.
 */

import { jobFilePath } from './jobFileAsk';

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

/** Value-first page between the account step and plan/card. */
export const FIRST_RUN_WELCOME = '/welcome';

export type FirstRunPath = 'field' | 'office';

export interface FirstRunState {
  jobId?: string;
  jobTitle?: string;
  jobNumber?: number | null;
  path?: FirstRunPath;
  /** First evidence was on screen: the creator's own first clip, or the labeled sample. */
  evidenceSeen?: boolean;
}

const FIRST_RUN_KEY = 'atmosphere.firstRun.';

/** This browser's first-run progress for one org. A UI hint only; billing is enforced server-side by the gate. */
export function readFirstRun(orgId: string | null | undefined): FirstRunState {
  if (!orgId) return {};
  try {
    const raw = localStorage.getItem(FIRST_RUN_KEY + orgId);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' ? (parsed as FirstRunState) : {};
  } catch {
    return {};
  }
}

export function writeFirstRun(orgId: string | null | undefined, patch: FirstRunState): FirstRunState {
  const next = { ...readFirstRun(orgId), ...patch };
  if (!orgId) return next;
  try {
    localStorage.setItem(FIRST_RUN_KEY + orgId, JSON.stringify(next));
  } catch {
    /* private mode: the page still works for this visit */
  }
  return next;
}

/** Billing step URL. Stripe checkout returns to ?step=2 as before. */
export function billingStepHref(next: string | null | undefined): string {
  const target = (next ?? '').trim();
  return target ? `/signup?step=2&next=${encodeURIComponent(target)}` : '/signup?step=2';
}

/**
 * Where an unpaid workspace goes when it opens the office: the welcome page
 * until the first evidence has been seen, then plan and card.
 */
export function unpaidWorkspaceTarget(state: FirstRunState, returnPath: string): string {
  if (!state.evidenceSeen) {
    return `${FIRST_RUN_WELCOME}?next=${encodeURIComponent(returnPath)}`;
  }
  // Checkout returns to the first job, not Start a job, when the blocked page
  // was only a generic landing (dashboard, jobs list, Start a job itself).
  const pathOnly = returnPath.split(/[?#]/)[0] ?? returnPath;
  const generic = GENERIC_POST_AUTH.has(pathOnly) || pathOnly === FIRST_RUN_HOME || pathOnly === FIRST_RUN_WELCOME;
  if (state.jobId && generic) {
    return billingStepHref(
      jobFilePath(state.jobId, { title: state.jobTitle, number: state.jobNumber ?? null }),
    );
  }
  return billingStepHref(returnPath);
}
