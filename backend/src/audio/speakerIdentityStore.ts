/**
 * Persist speaker decisions. Embeddings are written only for the signed-in
 * user; matching reads them with the service role and then applies the
 * consent filter. Failures are swallowed by the caller so a summary still lands.
 */

import { eligibleVoiceprints, type VoiceprintCandidate } from './speakerMatch.js';
import type { RoleGuessRow, SpeakerIdentityRow } from './speakerVerification.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

function missing(error: { message?: string; code?: string } | null | undefined): boolean {
  const message = error?.message ?? '';
  return error?.code === '42P01' || /does not exist|schema cache/i.test(message);
}

/**
 * Matching reads only the service-role function, which already drops other
 * companies who did not opt in. A failed call matches nothing. It must not
 * fall back to a table scan: that scan would load every company's embeddings.
 */
export async function loadMatchableVoiceprints(admin: any, orgId: string): Promise<VoiceprintCandidate[]> {
  if (typeof admin?.rpc !== 'function') {
    console.error('[speaker-identity] voiceprints_matchable is unavailable; matching nothing');
    return [];
  }
  try {
    const rpc = await admin.rpc('voiceprints_matchable', { p_org: orgId });
    if (rpc?.error || !Array.isArray(rpc?.data)) {
      console.error(
        '[speaker-identity] voiceprints_matchable failed; matching nothing:',
        rpc?.error?.message ?? rpc?.error ?? 'empty result',
      );
      return [];
    }
    return candidatesFromMatchableRpc(rpc.data, orgId);
  } catch (err) {
    console.error(
      '[speaker-identity] voiceprints_matchable failed; matching nothing:',
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

/**
 * The SQL function already dropped non-consenting and non-opted-in rows.
 * Mark them consented so the shared filter keeps the same-company and opt-in sets.
 * Cross-company rows are included by the function only when opted in; we pass
 * the uploader org through eligibleVoiceprints, so a same-org row is kept and
 * a cross-org row needs the flag. The function returns cross_company_opt_in.
 */
export function candidatesFromMatchableRpc(rows: any[], uploaderOrgId: string): VoiceprintCandidate[] {
  return eligibleVoiceprints(
    rows.map((row) => ({
      id: String(row.voiceprint_id),
      userId: String(row.user_id),
      orgId: String(row.org_id),
      displayName: String(row.full_name ?? '').trim(),
      embedding: Array.isArray(row.embedding) ? row.embedding.map(Number) : [],
      consentText: 'recorded',
      consentedAt: new Date(0).toISOString(),
      crossCompanyOptIn: Boolean(row.cross_company_opt_in),
    })),
    uploaderOrgId,
  );
}

const IDENTITY_COLUMNS =
  'id, job_id, proof_id, speaker_label, display_name, status, method, confidence, voiceprint_id, subject_user_id, source_proof_id, source_t_sec, source_quote, clip_title';

export function identityFromRow(row: any): SpeakerIdentityRow {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    proofId: String(row.proof_id),
    speakerLabel: String(row.speaker_label),
    displayName: row.display_name ?? null,
    status: row.status,
    method: row.method,
    confidence: row.confidence == null ? null : Number(row.confidence),
    voiceprintId: row.voiceprint_id ?? null,
    subjectUserId: row.subject_user_id ?? null,
    sourceProofId: row.source_proof_id ?? null,
    sourceTSec: row.source_t_sec == null ? null : Number(row.source_t_sec),
    sourceQuote: row.source_quote ?? null,
    clipTitle: row.clip_title ?? null,
  };
}

export async function loadProofIdentities(admin: any, proofId: string): Promise<SpeakerIdentityRow[]> {
  const { data, error } = await admin.from('speaker_identities').select(IDENTITY_COLUMNS).eq('proof_id', proofId);
  if (error) {
    if (missing(error)) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map(identityFromRow);
}

/**
 * A confirmed name or any voice match closes the pending name question for
 * that speaker. The unique key is per method, so the pickup row would otherwise
 * stay open beside voice_high and a later Yes would overwrite the voice name.
 */
export async function rejectSupersededPending(admin: any, proofId: string): Promise<void> {
  const { data, error } = await admin
    .from('speaker_identities')
    .select('id, speaker_label, method, status')
    .eq('proof_id', proofId);
  if (error) {
    if (missing(error)) return;
    throw new Error(error.message);
  }
  const groups = new Map<string, any[]>();
  for (const row of data ?? []) {
    const label = String(row.speaker_label).toLowerCase();
    const list = groups.get(label) ?? [];
    list.push(row);
    groups.set(label, list);
  }
  const drop: string[] = [];
  for (const list of groups.values()) {
    const settled = list.some((row) => row.status === 'confirmed' || row.method === 'voice_high');
    const voiced = list.some((row) => String(row.method).startsWith('voice'));
    for (const row of list) {
      if (row.status !== 'pending') continue;
      if (settled || (voiced && row.method === 'name_pickup')) drop.push(String(row.id));
    }
  }
  if (!drop.length) return;
  const { error: updateError } = await admin
    .from('speaker_identities')
    .update({ status: 'rejected', updated_at: new Date().toISOString() })
    .in('id', drop);
  if (updateError && !missing(updateError)) throw new Error(updateError.message);
}

export async function insertIdentityRows(admin: any, orgId: string, rows: SpeakerIdentityRow[]): Promise<void> {
  if (!rows.length) return;
  const proofId = rows[0]!.proofId;
  const { data: existing, error: readError } = await admin
    .from('speaker_identities')
    .select('speaker_label, method, status')
    .eq('proof_id', proofId);
  if (readError) {
    if (missing(readError)) return;
    throw new Error(readError.message);
  }
  const locked = new Set(
    (existing ?? [])
      .filter((row: any) => row.status === 'confirmed' || row.status === 'rejected')
      .map((row: any) => `${String(row.speaker_label).toLowerCase()}|${row.method}`),
  );
  const settled = new Set(
    (existing ?? [])
      .filter((row: any) => row.status === 'confirmed' || row.method === 'voice_high')
      .map((row: any) => String(row.speaker_label).toLowerCase()),
  );
  const voiced = new Set(
    (existing ?? [])
      .filter((row: any) => row.status === 'confirmed' || String(row.method).startsWith('voice'))
      .map((row: any) => String(row.speaker_label).toLowerCase()),
  );
  const open = rows.filter((row) => {
    const label = row.speakerLabel.toLowerCase();
    if (locked.has(`${label}|${row.method}`)) return false;
    if (row.status === 'pending' && row.method === 'name_pickup' && voiced.has(label)) return false;
    if (row.status === 'pending' && settled.has(label)) return false;
    return true;
  });
  if (!open.length) {
    await rejectSupersededPending(admin, proofId);
    return;
  }
  const payload = open.map((row) => ({
    org_id: orgId,
    job_id: row.jobId,
    proof_id: row.proofId,
    speaker_label: row.speakerLabel,
    display_name: row.displayName,
    status: row.status,
    method: row.method,
    confidence: row.confidence,
    voiceprint_id: row.voiceprintId,
    subject_user_id: row.subjectUserId,
    source_proof_id: row.sourceProofId,
    source_t_sec: row.sourceTSec,
    source_quote: row.sourceQuote,
    clip_title: row.clipTitle,
  }));
  const { error } = await admin.from('speaker_identities').upsert(payload, {
    onConflict: 'proof_id,speaker_label,method',
  });
  if (error && !missing(error)) throw new Error(error.message);
  if (!error) await rejectSupersededPending(admin, proofId);
}

export async function insertRoleGuesses(admin: any, orgId: string, jobId: string, rows: RoleGuessRow[]): Promise<void> {
  if (!rows.length) return;
  const { data: existing, error: readError } = await admin
    .from('speaker_role_guesses')
    .select('speaker_label, status')
    .eq('proof_id', rows[0]!.proofId);
  if (readError) {
    if (missing(readError)) return;
    throw new Error(readError.message);
  }
  const locked = new Set(
    (existing ?? [])
      .filter((row: any) => row.status && row.status !== 'tentative')
      .map((row: any) => String(row.speaker_label).toLowerCase()),
  );
  const open = rows.filter((row) => !locked.has(row.speakerLabel.toLowerCase()));
  if (!open.length) return;
  const payload = open.map((row) => ({
    org_id: orgId,
    job_id: jobId,
    proof_id: row.proofId,
    speaker_label: row.speakerLabel,
    role: row.role,
    confidence: row.confidence,
    source_t_sec: row.tSec,
    source_quote: row.quote.slice(0, 500),
    clip_title: row.clipTitle,
    status: row.status,
  }));
  const { error } = await admin.from('speaker_role_guesses').upsert(payload, {
    onConflict: 'proof_id,speaker_label',
  });
  if (error && !missing(error)) throw new Error(error.message);
}
