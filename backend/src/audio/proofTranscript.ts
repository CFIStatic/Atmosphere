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
import { transcriptionEnabled, transcribeAudio } from '../lib/transcription.js';
import { RetryQueue } from '../shared/retryQueue.js';

const PROOF_BUCKET = 'job-proofs';

/* eslint-disable @typescript-eslint/no-explicit-any */

const MAX_SECONDS = 600;
const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';

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

export function wavExtractArgs(input: string, output: string, maxSeconds = MAX_SECONDS): string[] {
  return ['-y', '-hide_banner', '-loglevel', 'error', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-t', String(maxSeconds), output];
}

/** ffmpeg reads a signed URL or local path. Node never holds the day film. */
export async function extractWavFromInput(input: string, maxSeconds = MAX_SECONDS): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'proof-audio-'));
  const output = join(dir, 'speech.wav');
  try {
    const { code, stderr } = await run(FFMPEG, wavExtractArgs(input, output, maxSeconds));
    if (code !== 0) throw new Error(stderr.slice(0, 400) || 'ffmpeg could not pull audio.');
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function extractWavFromVideo(video: Buffer, maxSeconds = MAX_SECONDS): Promise<Buffer> {
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
    .select('id, storage_path')
    .eq('id', proofId)
    .maybeSingle();
  if (error || !proof?.storage_path) throw new Error('The video file is not on record.');

  const url = await signedProofVideoUrl(admin, proof.storage_path);
  const wav = await extractWavFromInput(url);
  if (wav.length < 1000) {
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

  const text = await transcribeAudio(wav, 'audio/wav');
  await admin
    .from('job_proofs')
    .update({
      transcript_status: 'done',
      transcript_text: text.slice(0, 20_000),
      transcript_error: null,
      transcribed_at: new Date().toISOString(),
    })
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
