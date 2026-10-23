/**
 * Learn voiceprints automatically from job clips. No recorded sample.
 *
 * After a clip is summarized (and whenever someone confirms who a speaker is),
 * every speaker on that clip with a settled name (a confirmed identity or a
 * high voice match) is tied to a company member: the identity's
 * subject_user_id, or else the one member whose profile name matches exactly.
 * If that member has a recorded voiceprint consent (legal/voiceConsent.ts),
 * that speaker's own lines are embedded and the member's voiceprint is
 * created, or blended into the existing one when the new audio sounds like
 * the same voice. Without recorded consent nothing is stored.
 *
 * Voiceprints untouched for three years are destroyed here too (BIPA).
 */

import { cosineSimilarity, decodeWavPcm, embedSpeakerRanges, l2normalize, SPEAKER_EMBEDDING_MODEL } from './speakerEmbedding.js';
import { extractWavFromInput, signedProofVideoUrl, TRANSCRIPT_CHUNK_SECONDS } from './proofTranscript.js';
import { linesFromTranscript, type TranscriptLine } from './speakerNamePickup.js';
import { speakerMatchWindows } from './speakerClipApply.js';
import { matchThresholds } from './speakerMatch.js';
import { consentedUserIds, VOICE_CONSENT_RECORD_TEXT } from '../legal/voiceConsent.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Weight of a new clip when blending into an existing voiceprint. */
export const LEARN_BLEND = 0.3;
export const VOICEPRINT_RETENTION_DAYS = 365 * 3;

type SettledSpeaker = { speakerLabel: string; userId: string };

function normName(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Speaker label → member user id. A name shared by two members ties to no one.
 * A label claimed by two different people is skipped.
 */
export function settledSpeakers(
  identities: Array<{ speaker_label?: unknown; display_name?: unknown; status?: unknown; method?: unknown; subject_user_id?: unknown }>,
  members: Array<{ userId: string; fullName: string | null }>,
): SettledSpeaker[] {
  const memberIds = new Set(members.map((m) => m.userId));
  const byName = new Map<string, string | null>();
  for (const member of members) {
    const key = normName(member.fullName);
    if (!key) continue;
    byName.set(key, byName.has(key) ? null : member.userId);
  }
  const byLabel = new Map<string, string | null>();
  const labelText = new Map<string, string>();
  for (const row of identities) {
    const settled = row.status === 'confirmed' || row.method === 'voice_high';
    if (!settled || row.status === 'rejected') continue;
    const label = String(row.speaker_label ?? '').trim();
    if (!label) continue;
    const subject = row.subject_user_id ? String(row.subject_user_id) : null;
    const userId = subject && memberIds.has(subject) ? subject : (byName.get(normName(row.display_name)) ?? null);
    if (!userId) continue;
    const key = label.toLowerCase();
    labelText.set(key, label);
    const prior = byLabel.get(key);
    byLabel.set(key, prior === undefined || prior === userId ? userId : null);
  }
  const out: SettledSpeaker[] = [];
  const usedUsers = new Set<string>();
  for (const [key, userId] of byLabel) {
    if (!userId || usedUsers.has(userId)) continue;
    usedUsers.add(userId);
    out.push({ speakerLabel: labelText.get(key)!, userId });
  }
  return out;
}

/** Blend a new clip into the stored voiceprint, or null when it does not sound like the same person. */
export function blendEmbedding(stored: number[], fresh: number[], minSimilarity: number): number[] | null {
  if (!stored.length || stored.length !== fresh.length) return fresh;
  if (cosineSimilarity(stored, fresh) < minSimilarity) return null;
  return l2normalize(stored.map((value, i) => value * (1 - LEARN_BLEND) + fresh[i]! * LEARN_BLEND));
}

function averageEmbeddings(list: number[][]): number[] | null {
  const first = list[0];
  if (!first) return null;
  const sum = new Array<number>(first.length).fill(0);
  for (const e of list) {
    if (e.length !== first.length) continue;
    for (let i = 0; i < e.length; i += 1) sum[i]! += e[i]!;
  }
  return l2normalize(sum);
}

function rangesFor(lines: TranscriptLine[]): Array<{ startSec: number; endSec: number }> {
  const timed = lines.filter((line) => line.tSec != null);
  return timed.map((line, index) => {
    const start = line.tSec ?? 0;
    const next = timed[index + 1]?.tSec;
    const end = next != null && next > start ? next : start + 4;
    return { startSec: start, endSec: end };
  });
}

/** One embedding for this speaker's timed lines across the clip, or null. */
async function embedSpeakerAcrossClip(url: string, durationSeconds: unknown, allLines: TranscriptLine[], speakerLabel: string): Promise<{ embedding: number[]; seconds: number } | null> {
  const key = speakerLabel.toLowerCase();
  const pieces: number[][] = [];
  let seconds = 0;
  for (const pass of speakerMatchWindows(durationSeconds, allLines)) {
    // Only lines this speaker said, already shifted into the window.
    const mine = pass.lines.filter((line) => line.tSec != null && (line.speakerLabel ?? '').trim().toLowerCase() === key);
    if (!mine.length) continue;
    // Range ends must stop at the next line by anyone, not the next line by this speaker.
    const ordered = pass.lines.filter((line) => line.tSec != null).sort((a, b) => a.tSec! - b.tSec!);
    const ranges = rangesFor(ordered).filter((_, i) => (ordered[i]!.speakerLabel ?? '').trim().toLowerCase() === key);
    if (!ranges.length) continue;
    let wav: Buffer;
    try {
      wav = await extractWavFromInput(url, TRANSCRIPT_CHUNK_SECONDS, pass.start);
    } catch {
      continue;
    }
    if (wav.length < 1000) continue;
    try {
      const { samples, sampleRate } = decodeWavPcm(wav);
      const embedding = embedSpeakerRanges(samples, sampleRate, ranges);
      if (embedding) {
        pieces.push(embedding);
        seconds += ranges.reduce((sum, r) => sum + Math.max(0, r.endSec - r.startSec), 0);
      }
    } catch {
      continue;
    }
    if (pieces.length >= 4) break;
  }
  const embedding = averageEmbeddings(pieces);
  return embedding ? { embedding, seconds: Math.round(seconds * 100) / 100 } : null;
}

async function orgMembers(admin: any, orgId: string): Promise<Array<{ userId: string; fullName: string | null }>> {
  const { data, error } = await admin.from('org_members').select('user_id, profiles(full_name)').eq('org_id', orgId);
  if (error) return [];
  return (data ?? []).map((row: any) => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    return { userId: String(row.user_id), fullName: profile?.full_name ?? null };
  });
}

async function storeLearned(
  admin: any,
  input: { userId: string; orgId: string; consentedAt: string; embedding: number[]; seconds: number; minSimilarity: number },
): Promise<'created' | 'updated' | 'skipped'> {
  const now = new Date().toISOString();
  const { data: existing } = await admin
    .from('voiceprints')
    .select('id, org_id, duration_seconds')
    .eq('user_id', input.userId)
    .maybeSingle();
  if (existing?.id) {
    if (String(existing.org_id) !== input.orgId) return 'skipped';
    const { data: stored } = await admin
      .from('voiceprint_embeddings')
      .select('embedding')
      .eq('voiceprint_id', existing.id)
      .maybeSingle();
    const prior = Array.isArray(stored?.embedding) ? stored.embedding.map(Number) : [];
    const blended = blendEmbedding(prior, input.embedding, input.minSimilarity);
    if (!blended) return 'skipped';
    const emb = await admin
      .from('voiceprint_embeddings')
      .upsert({ voiceprint_id: existing.id, embedding: blended, dimension: blended.length }, { onConflict: 'voiceprint_id' });
    if (emb.error) throw new Error(emb.error.message);
    await admin
      .from('voiceprints')
      .update({
        duration_seconds: Math.min(36_000, Number(existing.duration_seconds ?? 0) + input.seconds),
        embedding_model: SPEAKER_EMBEDDING_MODEL,
        updated_at: now,
      })
      .eq('id', existing.id);
    return 'updated';
  }
  const created = await admin
    .from('voiceprints')
    .insert({
      user_id: input.userId,
      org_id: input.orgId,
      consent_text: VOICE_CONSENT_RECORD_TEXT,
      consented_at: input.consentedAt,
      cross_company_opt_in: false,
      duration_seconds: input.seconds,
      embedding_model: SPEAKER_EMBEDDING_MODEL,
      updated_at: now,
    })
    .select('id')
    .single();
  if (created.error || !created.data?.id) throw new Error(created.error?.message ?? 'voiceprint insert failed');
  const emb = await admin
    .from('voiceprint_embeddings')
    .upsert(
      { voiceprint_id: created.data.id, embedding: input.embedding, dimension: input.embedding.length },
      { onConflict: 'voiceprint_id' },
    );
  if (emb.error) {
    await admin.from('voiceprints').delete().eq('id', created.data.id);
    throw new Error(emb.error.message);
  }
  return 'created';
}

/** Destroy voiceprints with no activity for three years. */
export async function purgeStaleVoiceprints(admin: any, now: Date = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - VOICEPRINT_RETENTION_DAYS * 86_400_000).toISOString();
  const { error } = await admin.from('voiceprints').delete().lt('updated_at', cutoff);
  if (error) console.warn('[voiceprint-learn] retention purge failed:', error.message);
}

export async function learnVoiceprintsFromClip(admin: any, proofId: string): Promise<void> {
  await purgeStaleVoiceprints(admin);
  const { data: proof, error } = await admin
    .from('job_proofs')
    .select('id, org_id, job_id, storage_path, transcript_text, duration_seconds, deleted_at')
    .eq('id', proofId)
    .maybeSingle();
  if (error || !proof?.storage_path || !proof.org_id || proof.deleted_at) return;
  const orgId = String(proof.org_id);
  const { data: identities } = await admin
    .from('speaker_identities')
    .select('speaker_label, display_name, status, method, subject_user_id')
    .eq('proof_id', proofId);
  if (!identities?.length) return;
  const members = await orgMembers(admin, orgId);
  const speakers = settledSpeakers(identities, members);
  if (!speakers.length) return;
  // Consent gate: only people with a recorded voiceprint consent.
  const consent = await consentedUserIds(admin, speakers.map((s) => s.userId));
  const eligible = speakers.filter((s) => consent.has(s.userId));
  if (!eligible.length) return;
  const lines = linesFromTranscript(proof.transcript_text);
  if (!lines.some((line) => line.tSec != null)) return;
  const url = await signedProofVideoUrl(admin, proof.storage_path);
  const { medium } = matchThresholds();
  for (const speaker of eligible) {
    try {
      const sample = await embedSpeakerAcrossClip(url, proof.duration_seconds, lines, speaker.speakerLabel);
      if (!sample) continue;
      await storeLearned(admin, {
        userId: speaker.userId,
        orgId,
        consentedAt: consent.get(speaker.userId)!,
        embedding: sample.embedding,
        seconds: sample.seconds,
        minSimilarity: medium,
      });
    } catch (err) {
      console.warn('[voiceprint-learn] skipped a speaker:', err instanceof Error ? err.message : err);
    }
  }
}
