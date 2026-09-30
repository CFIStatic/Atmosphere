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

export async function loadMatchableVoiceprints(admin: any, orgId: string): Promise<VoiceprintCandidate[]> {
  if (typeof admin?.rpc === 'function') {
    const rpc = await admin.rpc('voiceprints_matchable', { p_org: orgId });
    if (!rpc.error && Array.isArray(rpc.data)) {
      return candidatesFromMatchableRpc(rpc.data, orgId);
    }
  }
  const { data, error } = await admin
    .from('voiceprints')
    .select('id, user_id, org_id, consent_text, consented_at, cross_company_opt_in, profiles(full_name), voiceprint_embeddings(embedding)');
  if (error || !Array.isArray(data)) return [];
  return eligibleVoiceprints(data.map(rowFromTable), orgId);
}

function rowFromTable(row: any): VoiceprintCandidate {
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  const embeddingRow = Array.isArray(row.voiceprint_embeddings) ? row.voiceprint_embeddings[0] : row.voiceprint_embeddings;
  const embedding = Array.isArray(embeddingRow?.embedding) ? embeddingRow.embedding.map(Number) : [];
  return {
    id: String(row.id),
    userId: String(row.user_id),
    orgId: String(row.org_id),
    displayName: String(profile?.full_name ?? '').trim(),
    embedding,
    consentText: row.consent_text ?? null,
    consentedAt: row.consented_at ?? null,
    crossCompanyOptIn: Boolean(row.cross_company_opt_in),
  };
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
  const open = rows.filter((row) => !locked.has(`${row.speakerLabel.toLowerCase()}|${row.method}`));
  if (!open.length) return;
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
