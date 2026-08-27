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
import { createAdminClient } from '../lib/supabase.js';
import { transcriptionEnabled, transcribeAudioDetailed } from '../lib/transcription.js';
import { RetryQueue } from '../shared/retryQueue.js';
import { extractConversationDetails, mergeConversationFindings } from './conversationDetails.js';
import { formatTimestampedTranscript } from './transcriptFormat.js';

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

/** Write speech + extracted talk facts without touching the visual reading. */
export function transcriptPersistPatch(
  text: string,
  existingFindings: unknown,
): {
  transcript_status: 'done';
  transcript_text: string;
  transcript_error: null;
  transcribed_at: string;
  ai_findings: Record<string, unknown>;
} {
  const stamped = formatTimestampedTranscript(text);
  const details = extractConversationDetails(stamped);
  return {
    transcript_status: 'done',
    transcript_text: stamped.slice(0, MAX_TRANSCRIPT_CHARS),
    transcript_error: null,
    transcribed_at: new Date().toISOString(),
    ai_findings: mergeConversationFindings(existingFindings, details),
  };
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

export async function transcribeProofVideo(admin: any, proofId: string): Promise<void> {
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

  await admin.from('job_proofs').update({ transcript_status: 'running' }).eq('id', proofId);

  const { data: proof, error } = await admin
    .from('job_proofs')
    .select('id, storage_path, duration_seconds')
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

  const hearSlice = async (start: number): Promise<string> => {
    const wav = await extractWavFromInput(url, TRANSCRIPT_CHUNK_SECONDS, start);
    if (wav.length < 1000) return '';
    const slice = await transcribeAudioDetailed(wav, 'audio/wav');
    return formatTimestampedTranscript(slice.text, {
      offsetSeconds: start,
      segments: slice.segments,
    });
  };

  if (knownStarts.length) {
    for (const start of knownStarts) {
      const body = await hearSlice(start);
      if (body) parts.push(body);
    }
  } else {
    // No clock on the row and ffprobe could not read one. Walk 10-minute
    // slices until the extract is empty so a long silent-header film is
    // still heard in full, not sampled at the opening.
    for (let start = 0; start < MAX_TRANSCRIPT_SECONDS; start += TRANSCRIPT_CHUNK_SECONDS) {
      const wav = await extractWavFromInput(url, TRANSCRIPT_CHUNK_SECONDS, start);
      if (wav.length < 1000) break;
      const slice = await transcribeAudioDetailed(wav, 'audio/wav');
      const body = formatTimestampedTranscript(slice.text, {
        offsetSeconds: start,
        segments: slice.segments,
      });
      if (body) parts.push(body);
    }
  }

  if (!parts.length) {
    await admin
      .from('job_proofs')
      .update({
        transcript_status: 'skipped',
        transcript_error: 'No usable audio track on this clip.',
        transcript_text: null,
      })
      .eq('id', proofId);
    return;
  }

  const { data: current } = await admin
    .from('job_proofs')
    .select('ai_findings')
    .eq('id', proofId)
    .maybeSingle();

  await admin
    .from('job_proofs')
    .update(transcriptPersistPatch(parts.join('\n'), current?.ai_findings ?? null))
    .eq('id', proofId);
}

const transcriptQueue = new RetryQueue<TranscriptJob>({
  run: async (job) => {
    const admin = createAdminClient();
    if (!admin) throw new Error('Storage is not configured.');
    await transcribeProofVideo(admin, job.proofId);
  },
  onGaveUp: async (job, error) => {
    const admin = createAdminClient();
    if (!admin) return;
    await admin
      .from('job_proofs')
      .update({
        transcript_status: 'failed',
        transcript_error: error instanceof Error ? error.message : 'Transcription failed.',
      })
      .eq('id', job.proofId);
  },
});

export async function queueProofTranscript(admin: any, proofId: string): Promise<void> {
  try {
    await admin.from('job_proofs').update({ transcript_status: 'queued' }).eq('id', proofId);
    transcriptQueue.enqueue({ key: `mic:${proofId}`, proofId });
  } catch {
    /* never fail the upload */
  }
}
