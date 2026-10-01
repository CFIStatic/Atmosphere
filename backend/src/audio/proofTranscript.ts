/**
 * Speech on a filed day film.
 *
 * Vision already describes the frames. This is the matching pass for the mic:
 * pull a short WAV from the stored video, send it to the same Whisper-compatible
 * endpoint the technician voice path uses, write the text onto the proof.
 *
 * Additive. A missing transcriber or a silent clip must never fail the upload.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unscopedAdminOrNull, writerForJob } from '../lib/scopedAdmin.js';
import {
  transcriptionEnabled,
  transcribeAudioTimed,
  transcriptAlreadyStamped,
  type TimedSegment,
  type TimedWord,
} from '../lib/transcription.js';
import { RetryQueue } from '../shared/retryQueue.js';
import { shouldRunSoldPathWorkers } from '../bootFlags.js';
import { leaseOwnerId, leaseUntilIso } from '../verification/lease.js';
import { modelPriceTable, whisperCostNanos } from '../metering/modelPriceTable.js';
import { recordFlatProviderCost } from '../metering/tokenUsage.js';
import { queueSummaryRefresh } from './summaryQueue.js';
import { staleSummaryPatch } from './summaryFreshness.js';
import { runSafetyScanForProof } from '../safety/sample.js';
import { writeTranscriptChunks } from '../shared/askTranscriptChunkStore.js';

const PROOF_BUCKET = 'job-proofs';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** One Whisper-sized slice. 10 min of 16 kHz mono WAV stays under typical 25 MB caps. */
export const TRANSCRIPT_CHUNK_SECONDS = 600;
/** Same ceiling as proof uploads — a workday, not a first-ten-minutes sample. */
export const MAX_TRANSCRIPT_SECONDS = 24 * 60 * 60;
const MAX_TRANSCRIPT_CHARS = 100_000;
const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe';

export interface TranscriptJob {
  key: string;
  proofId: string;
}

function run(bin: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stderr }));
  });
}

function runCapture(bin: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/** How long the filed film is, when the row was uploaded without a clock. */
export async function probeDurationSeconds(input: string): Promise<number | null> {
  try {
    const { code, stdout } = await runCapture(FFPROBE, [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      input,
    ]);
    if (code !== 0) return null;
    const n = Number(String(stdout).trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function wavExtractArgs(
  input: string,
  output: string,
  maxSeconds = TRANSCRIPT_CHUNK_SECONDS,
  startSeconds = 0,
): string[] {
  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  if (startSeconds > 0) args.push('-ss', String(Math.floor(startSeconds)));
  args.push('-i', input, '-vn', '-ac', '1', '-ar', '16000', '-t', String(maxSeconds), output);
  return args;
}

/** Starts of 10-minute slices covering the whole recording, however long it is. */
export function planAudioChunks(
  durationSeconds: number | null | undefined,
  chunkSeconds = TRANSCRIPT_CHUNK_SECONDS,
): number[] {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const capped = Math.min(duration, MAX_TRANSCRIPT_SECONDS);
  const starts: number[] = [];
  for (let at = 0; at < capped; at += chunkSeconds) starts.push(at);
  return starts;
}

function stampChunk(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${m}:${String(r).padStart(2, '0')}`;
}

/** ffmpeg reads a signed URL or local path. Node never holds the day film. */
export async function extractWavFromInput(
  input: string,
  maxSeconds = TRANSCRIPT_CHUNK_SECONDS,
  startSeconds = 0,
): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'proof-audio-'));
  const output = join(dir, 'speech.wav');
  try {
    const { code, stderr } = await run(FFMPEG, wavExtractArgs(input, output, maxSeconds, startSeconds));
    if (code !== 0) throw new Error(stderr.slice(0, 400) || 'ffmpeg could not pull audio.');
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function extractWavFromVideo(
  video: Buffer,
  maxSeconds = TRANSCRIPT_CHUNK_SECONDS,
): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'proof-audio-'));
  const input = join(dir, 'clip.bin');
  try {
    await writeFile(input, video);
    return await extractWavFromInput(input, maxSeconds);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function signedProofVideoUrl(admin: any, storagePath: string): Promise<string> {
  const { data: signed, error } = await admin.storage.from(PROOF_BUCKET).createSignedUrl(storagePath, 60 * 60);
  if (error || !signed?.signedUrl) {
    throw new Error(error?.message ?? 'Could not mint a signed URL for the filed video.');
  }
  return signed.signedUrl as string;
}

const MAX_STORED_SEGMENTS = 20_000;
const MAX_STORED_WORDS = 80_000;

export type TranscribeProofOptions = {
  /**
   * The transcript safety scan. Off for the timing backfill. The AI summary is
   * rebuilt on every transcript write regardless: the write marks it stale and
   * queues it, so a re-transcription never leaves the old summary in place.
   */
  enrich?: boolean;
  /**
   * A re-run that hears nothing must not wipe a transcript the office already
   * has. The row stays `done` with its text, and the caller can retry.
   */
  preserveExistingOnEmpty?: boolean;
};

export async function transcribeProofVideo(
  admin: any,
  proofId: string,
  opts?: TranscribeProofOptions,
): Promise<void> {
  if (!transcriptionEnabled()) {
    await admin
      .from('job_proofs')
      .update({
        transcript_status: 'skipped',
        transcript_error: 'Speech-to-text is not configured on this server.',
      })
      .eq('id', proofId);
    return;
  }

  await admin
    .from('job_proofs')
    .update({
      transcript_status: 'running',
      transcript_lease_owner: leaseOwnerId(),
      transcript_lease_until: leaseUntilIso(),
    })
    .eq('id', proofId);

  const { data: proof, error } = await admin
    .from('job_proofs')
    .select('id, org_id, job_id, party_id, clip_id, storage_path, duration_seconds, lat, lon')
    .eq('id', proofId)
    .maybeSingle();
  if (error || !proof?.storage_path) throw new Error('The video file is not on record.');

  const url = await signedProofVideoUrl(admin, proof.storage_path);
  let duration = Number(proof.duration_seconds);
  if (!Number.isFinite(duration) || duration <= 0) {
    const probed = await probeDurationSeconds(url);
    if (probed) {
      duration = probed;
      await admin
        .from('job_proofs')
        .update({ duration_seconds: Math.round(probed * 100) / 100 })
        .eq('id', proofId);
    }
  }

  const knownStarts = planAudioChunks(duration);
  const parts: string[] = [];
  const segments: TimedSegment[] = [];
  const words: TimedWord[] = [];
  const stamp = (start: number, many: boolean, body: string) => {
    if (transcriptAlreadyStamped(body)) return body;
    return many || start > 0 ? `[${stampChunk(start)}] ${body}` : body;
  };
  const takeSlice = async (start: number, many: boolean) => {
    const wav = await extractWavFromInput(url, TRANSCRIPT_CHUNK_SECONDS, start);
    if (wav.length < 1000) return false;
    const slice = await transcribeAudioTimed(wav, 'audio/wav', { timeOffsetSeconds: start });
    const body = slice.text.trim();
    if (!body && !slice.words.length) return true;
    if (body) parts.push(stamp(start, many, body));
    segments.push(...slice.segments);
    words.push(...slice.words);
    return true;
  };

  if (knownStarts.length) {
    for (const start of knownStarts) {
      await takeSlice(start, knownStarts.length > 1);
    }
  } else {
    // No clock on the row and ffprobe could not read one. Walk 10-minute
    // slices until the extract is empty so a long silent-header film is
    // still heard in full, not sampled at the opening.
    for (let start = 0; start < MAX_TRANSCRIPT_SECONDS; start += TRANSCRIPT_CHUNK_SECONDS) {
      const wav = await extractWavFromInput(url, TRANSCRIPT_CHUNK_SECONDS, start);
      if (wav.length < 1000) break;
      const slice = await transcribeAudioTimed(wav, 'audio/wav', { timeOffsetSeconds: start });
      const body = slice.text.trim();
      if (!body && !slice.words.length) continue;
      if (body) parts.push(stamp(start, true, body));
      segments.push(...slice.segments);
      words.push(...slice.words);
    }
  }

  if (!parts.length) {
    if (opts?.preserveExistingOnEmpty) {
      await admin
        .from('job_proofs')
        .update({ transcript_status: 'done', transcript_lease_until: null })
        .eq('id', proofId);
      throw new Error('No usable audio track on this clip.');
    }
    await admin
      .from('job_proofs')
      .update({
        transcript_status: 'skipped',
        transcript_error: 'No usable audio track on this clip.',
        transcript_text: null,
        transcript_segments: null,
        transcript_words: null,
        transcript_lease_until: null,
        ...staleSummaryPatch(),
      })
      .eq('id', proofId);
    await writeTranscriptChunks(admin, proofId);
    await queueSummaryRefresh(admin, proofId);
    return;
  }

  const transcriptText = parts.join('\n').slice(0, MAX_TRANSCRIPT_CHARS);
  await admin
    .from('job_proofs')
    .update({
      transcript_status: 'done',
      transcript_text: transcriptText,
      transcript_segments: segments.slice(0, MAX_STORED_SEGMENTS),
      transcript_words: words.slice(0, MAX_STORED_WORDS),
      transcript_error: null,
      transcribed_at: new Date().toISOString(),
      transcript_lease_until: null,
      // Same write: the summary on the row was built from the old text.
      ...staleSummaryPatch(),
    })
    .eq('id', proofId);

  // Rebuild the Ask transcript chunk index for this clip. Failure-tolerant:
  // a missing table or a failed write never fails the transcript save.
  await writeTranscriptChunks(admin, proofId);
  try {
    const { refreshClipRooms } = await import('../shared/roomPersist.js');
    await refreshClipRooms(admin, proofId, 'analysis');
  } catch (err) {
    console.warn('[rooms] transcript refresh failed', err instanceof Error ? err.message : err);
  }

  // Conversation summary, evidence log and people log are rebuilt on the
  // summary retry queue (never fails the Whisper write). This runs for the
  // timing backfill too — skipping it is how the Tiffany clip's summary went stale.
  await queueSummaryRefresh(admin, proofId);

  const heardSeconds = Number.isFinite(duration) && duration > 0 ? duration : 0;
  if (heardSeconds > 0 && proof.org_id) {
    // One charge per clip. The ledger no-ops a retry, sweep, or timing backfill.
    recordFlatProviderCost(admin, {
      orgId: proof.org_id,
      requestId: `whisper:${proofId}`,
      feature: 'transcription',
      source: 'whisper',
      modelId: 'whisper-1',
      costNanos: whisperCostNanos(modelPriceTable(), heardSeconds),
      jobId: proof.job_id ?? null,
    });
  }

  if (opts?.enrich === false) return;

  // Verbal threat / medical distress cues from the finished transcript.
  if (proof.org_id && proof.job_id && proof.party_id) {
    void runSafetyScanForProof(admin, {
      orgId: proof.org_id,
      jobId: proof.job_id,
      partyId: proof.party_id,
      proofId,
      clipId: proof.clip_id ?? null,
      transcriptSnippet: transcriptText.slice(0, 2000),
      lat: proof.lat == null ? null : Number(proof.lat),
      lon: proof.lon == null ? null : Number(proof.lon),
      source: 'transcript',
      allowModel: false,
    }).catch((err) => {
      console.warn('[safety] transcript scan failed:', err instanceof Error ? err.message : err);
    });
  }
}

async function adminForProof(proofId: string) {
  const raw = unscopedAdminOrNull();
  if (!raw) return null;
  const { data } = await raw
    .from('job_proofs')
    .select('org_id, job_id')
    .eq('id', proofId)
    .maybeSingle();
  if (!data?.org_id || !data?.job_id) return raw;
  return writerForJob({ orgId: data.org_id as string, jobId: data.job_id as string }, raw).raw;
}

const transcriptQueue = new RetryQueue<TranscriptJob>({
  run: async (job) => {
    const admin = await adminForProof(job.proofId);
    if (!admin) throw new Error('Storage is not configured.');
    await transcribeProofVideo(admin, job.proofId);
  },
  onGaveUp: async (job, error) => {
    const admin = await adminForProof(job.proofId);
    if (!admin) return;
    await admin
      .from('job_proofs')
      .update({
        transcript_status: 'failed',
        transcript_error: error instanceof Error ? error.message : 'Transcription failed.',
        transcript_lease_until: null,
      })
      .eq('id', job.proofId);
  },
});

export async function queueProofTranscript(admin: any, proofId: string): Promise<void> {
  try {
    await admin.from('job_proofs').update({ transcript_status: 'queued' }).eq('id', proofId);
    if (shouldRunSoldPathWorkers()) {
      transcriptQueue.enqueue({ key: `mic:${proofId}`, proofId });
    }
  } catch {
    /* never fail the upload */
  }
}
