/**
 * Voiceprint consent, recorded as a clickwrap release.
 *
 * The Terms checkbox at sign-up, invite acceptance and the one-time re-ack
 * reads "I agree to the Terms, including voiceprint consent". When it is
 * checked the server writes a row in terms_acceptances with the
 * VOICE_CONSENT_VERSION key (server timestamp, IP, user agent). That row is
 * the consent record. Turning voice recognition off deletes it and the
 * voiceprint, and logs a 'revoked' voice_consent_events row.
 *
 * Nobody is enrolled without this row. See audio/voiceprintLearn.ts.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** Not a Terms revision. latestTermsAcceptance skips rows with this prefix. */
export const VOICE_CONSENT_PREFIX = 'voiceprint:';
export const VOICE_CONSENT_VERSION = `${VOICE_CONSENT_PREFIX}2026-10-23`;

/** Stored on voiceprints.consent_text and voice_consent_events for the audit trail. */
export const VOICE_CONSENT_RECORD_TEXT =
  'Agreed to the Terms, including voiceprint consent (Section 3(g)): Atmosphere creates and updates a voiceprint from my own speech in job clip audio to recognize me as a speaker within my company. It is never sold, is not used on another company\'s jobs unless I turn on cross-company matching, and is destroyed when I revoke consent, when my account is deleted, or within three years of my last interaction.';

export type VoiceConsentStatus = {
  consented: boolean;
  consentedAt: string | null;
  /** The person turned voice recognition off. Do not prompt them again. */
  revoked: boolean;
  /** Show the one-time acceptance. */
  required: boolean;
};

/* eslint-disable @typescript-eslint/no-explicit-any */

function missingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  return (
    error?.code === '42P01' ||
    error?.code === 'PGRST205' ||
    /does not exist|schema cache|Could not find the table/i.test(error?.message ?? '')
  );
}

export function voiceConsentFromRows(
  acceptance: { accepted_at?: string | null } | null,
  latestEvent: { action?: string | null } | null,
): VoiceConsentStatus {
  const consentedAt = acceptance?.accepted_at ?? null;
  const consented = Boolean(consentedAt);
  const revoked = !consented && latestEvent?.action === 'revoked';
  return { consented, consentedAt, revoked, required: !consented && !revoked };
}

export async function loadVoiceConsent(admin: SupabaseClient | any, userId: string): Promise<VoiceConsentStatus> {
  const [acceptance, event] = await Promise.all([
    admin
      .from('terms_acceptances')
      .select('accepted_at')
      .eq('user_id', userId)
      .eq('terms_version', VOICE_CONSENT_VERSION)
      .maybeSingle(),
    admin
      .from('voice_consent_events')
      .select('action, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (acceptance?.error && !missingTable(acceptance.error)) throw new Error(acceptance.error.message);
  return voiceConsentFromRows(
    acceptance?.error ? null : (acceptance?.data ?? null),
    event?.error ? null : (event?.data ?? null),
  );
}

/** Users in `userIds` with a recorded voiceprint consent. */
export async function consentedUserIds(admin: any, userIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!userIds.length) return out;
  const { data, error } = await admin
    .from('terms_acceptances')
    .select('user_id, accepted_at')
    .eq('terms_version', VOICE_CONSENT_VERSION)
    .in('user_id', userIds);
  if (error) return out;
  for (const row of data ?? []) {
    if (row?.user_id && row?.accepted_at) out.set(String(row.user_id), String(row.accepted_at));
  }
  return out;
}

async function primaryOrg(admin: any, userId: string): Promise<string | null> {
  const { data } = await admin.from('org_members').select('org_id').eq('user_id', userId).limit(1).maybeSingle();
  return data?.org_id ? String(data.org_id) : null;
}

export async function recordVoiceConsent(
  admin: any,
  input: { userId: string; orgId?: string | null; ip?: string | null; userAgent?: string | null },
): Promise<VoiceConsentStatus> {
  const acceptedAt = new Date().toISOString();
  const { error } = await admin.from('terms_acceptances').upsert(
    {
      user_id: input.userId,
      terms_version: VOICE_CONSENT_VERSION,
      accepted_at: acceptedAt,
      ip: input.ip ?? null,
      user_agent: input.userAgent ?? null,
    },
    { onConflict: 'user_id,terms_version' },
  );
  if (error) throw new Error(error.message);
  const orgId = input.orgId ?? (await primaryOrg(admin, input.userId));
  if (orgId) {
    await admin.from('voice_consent_events').insert({
      user_id: input.userId,
      org_id: orgId,
      action: 'granted',
      consent_text: VOICE_CONSENT_RECORD_TEXT,
    });
  }
  return { consented: true, consentedAt: acceptedAt, revoked: false, required: false };
}

/** Delete the consent record and the voiceprint (embedding cascades). */
export async function revokeVoiceConsent(admin: any, input: { userId: string; orgId: string }): Promise<void> {
  const { data: existing } = await admin.from('voiceprints').select('id').eq('user_id', input.userId).maybeSingle();
  const removed = await admin.from('voiceprints').delete().eq('user_id', input.userId);
  if (removed.error) throw new Error(removed.error.message);
  const consent = await admin
    .from('terms_acceptances')
    .delete()
    .eq('user_id', input.userId)
    .eq('terms_version', VOICE_CONSENT_VERSION);
  if (consent.error) throw new Error(consent.error.message);
  await admin.from('voice_consent_events').insert({
    user_id: input.userId,
    org_id: input.orgId,
    action: 'revoked',
    consent_text: null,
  });
  if (existing?.id) {
    await admin
      .from('speaker_identities')
      .update({ status: 'rejected', voiceprint_id: null })
      .eq('voiceprint_id', existing.id)
      .eq('status', 'pending');
  }
}
