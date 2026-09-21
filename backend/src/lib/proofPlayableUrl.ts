/**
 * Safari (and some WebViews) cannot decode Field Capture WebM/VP8–VP9.
 * Stills + transcript still work because server ffmpeg can read WebM; the
 * office <video> element cannot. Mint a short-lived URL to an H.264/AAC
 * MP4 derivative (cached beside the original as `*.play.mp4`) so Platform
 * playback works on every browser we ship.
 *
 * Original `.webm` stays the filed object (hash / custody / download).
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from './errors.js';

export const PROOF_PLAYABLE_BUCKET = 'job-proofs';
/** Sibling of a WebM original — e.g. `…/clip.webm` → `…/clip.play.mp4`. */
export const PROOF_PLAYABLE_SUFFIX = '.play.mp4';

const TRANSCODE_TIMEOUT_MS = Number(process.env.PROOF_PLAYABLE_FFMPEG_TIMEOUT_MS || 180_000);

export type ProofPlayableRunner = (
  bin: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string; code: number }>;

export const defaultProofPlayableRunner: ProofPlayableRunner = (bin, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${bin} timed out after ${TRANSCODE_TIMEOUT_MS}ms`));
    }, TRANSCODE_TIMEOUT_MS);
    child.stdout.on('data', (d) => {
      stdout += String(d);
    });
    child.stderr.on('data', (d) => {
      stderr += String(d);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });

/** Path of the Safari-playable derivative, or null when the original is already fine. */
export function playableDerivativePath(storagePath: string): string | null {
  const path = String(storagePath ?? '').trim();
  if (!path) return null;
  if (!/\.webm$/i.test(path)) return null;
  return path.replace(/\.webm$/i, PROOF_PLAYABLE_SUFFIX);
}

export function needsPlayableDerivative(storagePath: string): boolean {
  return playableDerivativePath(storagePath) != null;
}

const inflight = new Map<string, Promise<void>>();

async function storageHasObject(
  admin: SupabaseClient,
  bucket: string,
  objectPath: string,
): Promise<boolean> {
  const parts = objectPath.split('/').filter(Boolean);
  const name = parts.pop();
  if (!name) return false;
  const folder = parts.join('/');
  const { data, error } = await admin.storage.from(bucket).list(folder, {
    limit: 100,
    search: name,
  });
  if (error) return false;
  return (data ?? []).some((row) => row.name === name);
}

async function buildPlayableDerivative(input: {
  admin: SupabaseClient;
  bucket: string;
  sourcePath: string;
  derivPath: string;
  runner?: ProofPlayableRunner;
  ffmpegPath?: string;
}): Promise<void> {
  const runner = input.runner ?? defaultProofPlayableRunner;
  const ffmpeg = input.ffmpegPath ?? process.env.FFMPEG_PATH ?? 'ffmpeg';

  const { data: signed, error: signErr } = await input.admin.storage
    .from(input.bucket)
    .createSignedUrl(input.sourcePath, 60 * 30);
  if (signErr || !signed?.signedUrl) {
    throw new HttpError(
      500,
      signErr?.message ?? 'Could not mint a signed URL to transcode the filed video.',
      'signed_url_failed',
    );
  }

  const workDir = join(tmpdir(), `atm-play-${randomUUID()}`);
  await mkdir(workDir, { recursive: true });
  const outPath = join(workDir, 'play.mp4');
  try {
    const { code, stderr } = await runner(ffmpeg, [
      '-y',
      '-i',
      signed.signedUrl,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      outPath,
    ]);
    if (code !== 0) {
      throw new Error(stderr.slice(0, 500) || 'ffmpeg could not build a playable MP4.');
    }
    const bytes = await readFile(outPath);
    if (!bytes.length) {
      throw new Error('ffmpeg wrote an empty playable MP4.');
    }
    const { error: upErr } = await input.admin.storage.from(input.bucket).upload(input.derivPath, bytes, {
      contentType: 'video/mp4',
      upsert: true,
    });
    if (upErr) {
      throw new HttpError(500, upErr.message, 'playable_upload_failed');
    }
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Ensure a Safari-playable object exists for a WebM original (no-op for mp4/mov).
 * Concurrent callers share one in-flight build per derivative path.
 */
export async function ensurePlayableDerivative(input: {
  admin: SupabaseClient;
  storagePath: string;
  bucket?: string;
  runner?: ProofPlayableRunner;
  ffmpegPath?: string;
}): Promise<string> {
  const bucket = input.bucket ?? PROOF_PLAYABLE_BUCKET;
  const deriv = playableDerivativePath(input.storagePath);
  if (!deriv) return input.storagePath;

  if (await storageHasObject(input.admin, bucket, deriv)) {
    return deriv;
  }

  let pending = inflight.get(deriv);
  if (!pending) {
    pending = buildPlayableDerivative({
      admin: input.admin,
      bucket,
      sourcePath: input.storagePath,
      derivPath: deriv,
      runner: input.runner,
      ffmpegPath: input.ffmpegPath,
    }).finally(() => {
      inflight.delete(deriv);
    });
    inflight.set(deriv, pending);
  }
  await pending;
  return deriv;
}

/**
 * Mint a short-lived signed URL the office player can actually decode.
 * Falls back to the original object if the derivative cannot be built so
 * Chrome/Firefox keep working even when ffmpeg is unavailable.
 */
export async function createSignedPlayableProofUrl(input: {
  admin: SupabaseClient;
  storagePath: string;
  expiresInSeconds?: number;
  bucket?: string;
  runner?: ProofPlayableRunner;
  ffmpegPath?: string;
}): Promise<{ url: string; storagePath: string; derived: boolean }> {
  const bucket = input.bucket ?? PROOF_PLAYABLE_BUCKET;
  const expiresInSeconds = input.expiresInSeconds ?? 600;
  const original = String(input.storagePath ?? '').trim();
  if (!original) {
    throw new HttpError(500, 'Proof has no storage path.', 'missing_storage_path');
  }

  let playPath = original;
  let derived = false;
  if (needsPlayableDerivative(original)) {
    try {
      playPath = await ensurePlayableDerivative({
        admin: input.admin,
        storagePath: original,
        bucket,
        runner: input.runner,
        ffmpegPath: input.ffmpegPath,
      });
      derived = playPath !== original;
    } catch (err) {
      // Prefer a working Chrome playback over a hard 500 when Safari needs a
      // derivative we could not build (missing ffmpeg, timeout, etc.).
      console.warn(
        '[proofPlayableUrl] derivative failed; serving original:',
        err instanceof Error ? err.message : err,
      );
      playPath = original;
      derived = false;
    }
  }

  const { data, error } = await input.admin.storage.from(bucket).createSignedUrl(playPath, expiresInSeconds);
  if (error || !data?.signedUrl) {
    throw new HttpError(500, error?.message ?? 'Could not mint a signed URL for playback.', 'signed_url_failed');
  }
  return { url: data.signedUrl, storagePath: playPath, derived };
}
