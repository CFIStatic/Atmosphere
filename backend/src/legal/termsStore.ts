import type { SupabaseClient } from '@supabase/supabase-js';
import { unscopedAdminOrNull } from '../lib/scopedAdmin.js';
import { HttpError } from '../lib/errors.js';
import { VOICE_CONSENT_PREFIX, loadVoiceConsent, recordVoiceConsent } from './voiceConsent.js';
import {
  CURRENT_TERMS_VERSION,
  TERMS_REQUIRED_CODE,
  TERMS_REQUIRED_MESSAGE,
  hasAcceptedCurrentTerms,
  isAcceptableTermsVersion,
  termsStatus,
  type TermsStatus,
} from './terms.js';

type AcceptanceRow = {
  terms_version: string;
  accepted_at: string;
};

/**
 * Always write/read terms_acceptances as service_role.
 *
 * POST /api/auth/terms/accept already verified the session (requireAuth →
 * auth.getUser). A user-scoped JWT client made PostgREST run as
 * `authenticated`, which needs table GRANTs plus an UPDATE policy because
 * upsert is INSERT ON CONFLICT DO UPDATE. Missing either surfaces as
 * `permission denied for table terms_acceptances`. service_role bypasses
 * RLS; rows are still keyed by the verified user id.
 */
function termsAdmin(): SupabaseClient {
  const admin = unscopedAdminOrNull();
  if (!admin) {
    throw new HttpError(
      503,
      'Cannot record Terms of Service acceptance until the server has a service role key.',
      'admin_unavailable',
    );
  }
  return admin;
}

function isMissingTermsTable(error: { code?: string; message?: string }): boolean {
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    /relation ["']?public\.?terms_acceptances["']? does not exist/i.test(error.message ?? '') ||
    /Could not find the table ['"]public\.terms_acceptances['"]/i.test(error.message ?? '')
  );
}

export async function latestTermsAcceptance(
  userId: string,
  _accessToken?: string | null,
): Promise<{ termsVersion: string; acceptedAt: string } | null> {
  const supabase = termsAdmin();
  const { data, error } = await supabase
    .from('terms_acceptances')
    .select('terms_version, accepted_at')
    .eq('user_id', userId)
    .not('terms_version', 'like', `${VOICE_CONSENT_PREFIX}%`)
    .order('accepted_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    // Rollout window: /me must still answer before the table exists.
    // Do not treat GRANT/RLS errors as "missing" — those must surface.
    if (isMissingTermsTable(error)) return null;
    throw new HttpError(500, error.message, 'terms_lookup_failed');
  }
  const row = data as AcceptanceRow | null;
  if (!row?.terms_version) return null;
  return { termsVersion: row.terms_version, acceptedAt: row.accepted_at };
}

export async function loadTermsStatus(
  userId: string,
  accessToken?: string | null,
): Promise<TermsStatus> {
  const status = termsStatus(await latestTermsAcceptance(userId, accessToken));
  return withVoiceConsent(status, userId);
}

/** Adds voiceConsentRequired. A lookup failure never blocks sign-in. */
async function withVoiceConsent(status: TermsStatus, userId: string): Promise<TermsStatus> {
  try {
    const voice = await loadVoiceConsent(termsAdmin(), userId);
    return { ...status, voiceConsentRequired: voice.required };
  } catch (err) {
    console.warn('[terms] voice consent lookup failed:', err instanceof Error ? err.message : err);
    return { ...status, voiceConsentRequired: false };
  }
}

/**
 * People who already accepted the current Terms. Every signed-in request
 * checks this, and an acceptance of this version is never withdrawn (a new
 * version ships with a deploy, which empties the map), so a yes is kept for a
 * while instead of read from the database on every call. A no is never kept.
 */
const ACCEPTED_TTL_MS = 10 * 60_000;
const accepted = new Map<string, { until: number; status: TermsStatus }>();

function acceptedKey(userId: string): string {
  return `${userId}|${CURRENT_TERMS_VERSION}`;
}

export function forgetTermsAcceptance(userId: string): void {
  accepted.delete(acceptedKey(userId));
}

export async function assertCurrentTermsAccepted(
  userId: string,
  accessToken?: string | null,
): Promise<TermsStatus> {
  const key = acceptedKey(userId);
  const hit = accepted.get(key);
  if (hit && hit.until > Date.now()) return hit.status;
  const status = await loadTermsStatus(userId, accessToken);
  if (status.required) {
    accepted.delete(key);
    throw new HttpError(403, TERMS_REQUIRED_MESSAGE, TERMS_REQUIRED_CODE);
  }
  if (accepted.size > 10_000) accepted.clear();
  accepted.set(key, { until: Date.now() + ACCEPTED_TTL_MS, status });
  return status;
}

export async function recordTermsAcceptance(input: {
  userId: string;
  accessToken?: string | null;
  termsVersion: string;
  ip?: string | null;
  userAgent?: string | null;
  /** The checkbox read "including voiceprint consent". */
  voiceConsent?: boolean;
}): Promise<TermsStatus> {
  if (!isAcceptableTermsVersion(input.termsVersion)) {
    throw new HttpError(
      400,
      'Acknowledge the current Terms of Service to continue.',
      'terms_version_mismatch',
    );
  }

  const supabase = termsAdmin();
  const { error } = await supabase.from('terms_acceptances').upsert(
    {
      user_id: input.userId,
      terms_version: CURRENT_TERMS_VERSION,
      accepted_at: new Date().toISOString(),
      ip: input.ip ?? null,
      user_agent: input.userAgent ?? null,
    },
    { onConflict: 'user_id,terms_version' },
  );

  if (error) {
    throw new HttpError(500, error.message, 'terms_record_failed');
  }

  const status = termsStatus({
    termsVersion: CURRENT_TERMS_VERSION,
    acceptedAt: new Date().toISOString(),
  });
  if (input.voiceConsent === true) {
    try {
      await recordVoiceConsent(supabase, {
        userId: input.userId,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      });
      return { ...status, voiceConsentRequired: false };
    } catch (err) {
      throw new HttpError(500, err instanceof Error ? err.message : 'Could not record consent.', 'terms_record_failed');
    }
  }
  return withVoiceConsent(status, input.userId);
}

export function requireAcceptedTermsVersion(version: string | null | undefined): string {
  if (!isAcceptableTermsVersion(version)) {
    throw new HttpError(
      400,
      'Acknowledge the Terms of Service to continue.',
      'terms_required',
    );
  }
  return CURRENT_TERMS_VERSION;
}

export { hasAcceptedCurrentTerms };
