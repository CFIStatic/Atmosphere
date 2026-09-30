/**
 * After a clip is summarized, compare its diarized speakers to the uploader's
 * company voiceprints (and opted-in prints from other companies). Audio
 * extraction failures are ignored. This does not change the transcriber.
 */

import { extractWavFromInput, signedProofVideoUrl } from './proofTranscript.js';
import { linesFromTranscript } from './speakerNamePickup.js';
import { addVoiceMatches } from './speakerPlan.js';
import { matchSpeakersInWav } from './speakerClipMatch.js';
import { insertIdentityRows, loadMatchableVoiceprints } from './speakerIdentityStore.js';
import { matchThresholds } from './speakerMatch.js';
import type { SpeakerIdentityRow } from './speakerVerification.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function matchProofSpeakers(admin: any, proofId: string): Promise<void> {
  const { data: proof, error } = await admin
    .from('job_proofs')
    .select('id, org_id, job_id, storage_path, title, custom_title, transcript_text')
    .eq('id', proofId)
    .maybeSingle();
  if (error || !proof?.storage_path || !proof.org_id || !proof.job_id) return;
  const prints = await loadMatchableVoiceprints(admin, proof.org_id);
  if (!prints.length) return;
  const url = await signedProofVideoUrl(admin, proof.storage_path);
  const wav = await extractWavFromInput(url, 60, 0);
  const lines = linesFromTranscript(proof.transcript_text);
  const matches = matchSpeakersInWav(wav, lines, prints, proof.org_id, matchThresholds());
  if (!matches.length) return;
  const { data: existing } = await admin
    .from('speaker_identities')
    .select('id, job_id, proof_id, speaker_label, display_name, status, method, confidence, voiceprint_id, subject_user_id, source_proof_id, source_t_sec, source_quote, clip_title')
    .eq('proof_id', proofId);
  const current: SpeakerIdentityRow[] = (existing ?? []).map(mapIdentity);
  const clipTitle = String(proof.custom_title || proof.title || 'this clip');
  const next = addVoiceMatches({
    jobId: proof.job_id,
    proofId,
    clipTitle,
    identities: current,
    matches,
  });
  const fresh = next.filter((row) => row.method === 'voice_high' || row.method === 'voice_medium');
  await insertIdentityRows(admin, proof.org_id, fresh);
  const confirmed = fresh.filter((row) => row.status === 'confirmed');
  if (confirmed.length) await stampConfirmedSpeakers(admin, String(proof.org_id), confirmed);
}

function mapIdentity(row: any): SpeakerIdentityRow {
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

/** Write a confirmed name onto people.displayName. Role guesses are never written. */
export async function stampConfirmedSpeakers(admin: any, orgId: string, identities: SpeakerIdentityRow[]): Promise<void> {
  const confirmed = identities.filter(
    (row) => row.displayName && (row.status === 'confirmed' || row.method === 'voice_high'),
  );
  const byProof = new Map<string, SpeakerIdentityRow[]>();
  for (const row of confirmed) {
    const list = byProof.get(row.proofId) ?? [];
    list.push(row);
    byProof.set(row.proofId, list);
  }
  for (const [proofId, rows] of byProof) {
    const { data } = await admin.from('job_proofs').select('org_id, ai_findings').eq('id', proofId).maybeSingle();
    if (!data || String(data.org_id ?? '') !== orgId) continue;
    const findings = data.ai_findings && typeof data.ai_findings === 'object' ? { ...data.ai_findings } : {};
    const people = findings.people && typeof findings.people === 'object' ? { ...findings.people } : null;
    if (!people) continue;
    const apply = (row: any) => {
      const label = String(row?.speakerLabel ?? '');
      const hit = rows.find((item) => item.speakerLabel.toLowerCase() === label.toLowerCase() && item.displayName);
      if (!hit?.displayName) return row;
      return {
        ...row,
        displayName: hit.displayName,
        identityMethod: hit.method.startsWith('voice') ? 'voice' : 'roster',
        identityConfidence: hit.confidence,
        identitySource: hit.sourceQuote,
      };
    };
    if (Array.isArray(people.people)) people.people = people.people.map(apply);
    if (Array.isArray(people.speakers)) people.speakers = people.speakers.map(apply);
    findings.people = people;
    await admin.from('job_proofs').update({ ai_findings: findings }).eq('id', proofId);
  }
}
