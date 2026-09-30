/**
 * After a clip is summarized, compare its diarized speakers to the uploader's
 * company voiceprints (and opted-in prints from other companies). Audio
 * extraction failures are ignored. This does not change the transcriber.
 */

import {
  extractWavFromInput,
  MAX_TRANSCRIPT_SECONDS,
  planAudioChunks,
  signedProofVideoUrl,
  TRANSCRIPT_CHUNK_SECONDS,
} from './proofTranscript.js';
import { linesFromTranscript, type TranscriptLine } from './speakerNamePickup.js';
import { addVoiceMatches, applyConfirmedNames } from './speakerPlan.js';
import { matchSpeakersInWav, type TimedVoiceMatch } from './speakerClipMatch.js';
import { identityFromRow, insertIdentityRows, loadMatchableVoiceprints } from './speakerIdentityStore.js';
import { matchThresholds, type MatchThresholds, type VoiceprintCandidate } from './speakerMatch.js';
import { toStoredPeople, type PeoplePresent } from './peoplePresent.js';
import type { SpeakerIdentityRow } from './speakerVerification.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function matchProofSpeakers(admin: any, proofId: string): Promise<void> {
  const { data: proof, error } = await admin
    .from('job_proofs')
    .select('id, org_id, job_id, storage_path, title, custom_title, transcript_text, duration_seconds')
    .eq('id', proofId)
    .maybeSingle();
  if (error || !proof?.storage_path || !proof.org_id || !proof.job_id) return;
  const prints = await loadMatchableVoiceprints(admin, proof.org_id);
  if (!prints.length) return;
  const url = await signedProofVideoUrl(admin, proof.storage_path);
  const lines = linesFromTranscript(proof.transcript_text);
  const matches = await matchSpeakersAcrossClip(url, proof.duration_seconds, lines, prints, proof.org_id, matchThresholds());
  if (!matches.length) return;
  const { data: existing } = await admin
    .from('speaker_identities')
    .select('id, job_id, proof_id, speaker_label, display_name, status, method, confidence, voiceprint_id, subject_user_id, source_proof_id, source_t_sec, source_quote, clip_title')
    .eq('proof_id', proofId);
  const current: SpeakerIdentityRow[] = (existing ?? []).map(identityFromRow);
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

/** Ten-minute windows. A day-long film is sampled, not decoded end to end. */
const MAX_SPEAKER_MATCH_WINDOWS = 12;

/** How much of the film to score: the stored duration, or the last spoken line when duration is missing. */
function matchSpanSeconds(durationSeconds: unknown, lines: TranscriptLine[]): number {
  const duration = Number(durationSeconds);
  const known = Number.isFinite(duration) && duration > 0 ? Math.min(duration, MAX_TRANSCRIPT_SECONDS) : 0;
  const last = lines.reduce((max, line) => Math.max(max, line.tSec ?? 0), 0);
  const speechEnd = last > 0 ? last + 4 : 0;
  return Math.min(MAX_TRANSCRIPT_SECONDS, Math.max(known, speechEnd, 1));
}

function evenSample(starts: number[], count: number): number[] {
  if (starts.length <= count) return starts;
  const picked: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const idx = Math.round((i * (starts.length - 1)) / (count - 1));
    const start = starts[idx]!;
    if (picked.at(-1) !== start) picked.push(start);
  }
  return picked;
}

/**
 * Windows covering the whole clip. Speech windows are kept. Past a dozen
 * slices, the rest of the duration is sampled evenly instead of decoded.
 */
export function speakerMatchWindowStarts(durationSeconds: unknown, lines: TranscriptLine[]): number[] {
  const all = planAudioChunks(matchSpanSeconds(durationSeconds, lines));
  const starts = all.length ? all : [0];
  const speech = new Set<number>();
  for (const line of lines) {
    if (line.tSec == null) continue;
    const start = Math.floor(line.tSec / TRANSCRIPT_CHUNK_SECONDS) * TRANSCRIPT_CHUNK_SECONDS;
    if (starts.includes(start)) speech.add(start);
  }
  const required = [...speech].sort((a, b) => a - b);
  if (starts.length <= MAX_SPEAKER_MATCH_WINDOWS) return starts;
  if (required.length >= MAX_SPEAKER_MATCH_WINDOWS) return evenSample(required, MAX_SPEAKER_MATCH_WINDOWS);
  const rest = evenSample(
    starts.filter((start) => !speech.has(start)),
    MAX_SPEAKER_MATCH_WINDOWS - required.length,
  );
  return [...required, ...rest].sort((a, b) => a - b);
}

/**
 * Transcription hears the whole day film in 10-minute slices. Voice match has
 * to use the same slices: a single opening minute drops every later speaker.
 */
async function matchSpeakersAcrossClip(
  url: string,
  durationSeconds: unknown,
  lines: TranscriptLine[],
  prints: VoiceprintCandidate[],
  uploaderOrgId: string,
  thresholds: MatchThresholds,
): Promise<TimedVoiceMatch[]> {
  const starts = speakerMatchWindowStarts(durationSeconds, lines);
  const best = new Map<string, TimedVoiceMatch>();
  for (const start of starts) {
    const chunkLines = lines.flatMap((line) => {
      if (line.tSec == null) return [line];
      const tSec = line.tSec - start;
      if (tSec < 0 || tSec >= TRANSCRIPT_CHUNK_SECONDS) return [];
      return [{ ...line, tSec }];
    });
    if (!chunkLines.length && lines.length > 0) continue;
    let wav: Buffer;
    try {
      wav = await extractWavFromInput(url, TRANSCRIPT_CHUNK_SECONDS, start);
    } catch {
      continue;
    }
    if (wav.length < 1000) continue;
    const found = matchSpeakersInWav(wav, chunkLines, prints, uploaderOrgId, thresholds);
    for (const match of found) {
      const key = match.speakerLabel.toLowerCase();
      const shifted = { ...match, tSec: match.tSec == null ? null : match.tSec + start };
      const prev = best.get(key);
      if (!prev || shifted.score > prev.score) best.set(key, shifted);
    }
  }
  return [...best.values()];
}

function peopleForStamp(raw: unknown): PeoplePresent {
  const row = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as PeoplePresent) : null;
  const source =
    row?.source === 'llm' || row?.source === 'deterministic' || row?.source === 'merged' || row?.source === 'empty'
      ? row.source
      : 'deterministic';
  return {
    count: Array.isArray(row?.people) ? row.people.length : 0,
    people: Array.isArray(row?.people) ? row.people : [],
    speakers: Array.isArray(row?.speakers) ? row.speakers : [],
    source,
    model: row?.model ?? null,
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
    const findings =
      data.ai_findings && typeof data.ai_findings === 'object' && !Array.isArray(data.ai_findings)
        ? { ...data.ai_findings }
        : {};
    const named = applyConfirmedNames(peopleForStamp(findings.people), rows);
    if (!named.people.length) continue;
    findings.people = toStoredPeople(named);
    await admin.from('job_proofs').update({ ai_findings: findings }).eq('id', proofId);
  }
}
