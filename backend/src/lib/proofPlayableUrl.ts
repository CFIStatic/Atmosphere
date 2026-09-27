/**
 * Office playback wants an H.264/AAC MP4 with the moov atom at the front
 * (faststart) so the first play() can start before the rest of the file
 * downloads, and so Safari can decode Field Capture WebM.
 *
 * The original stays the filed object (hash / custody / download). The
 * derivative sits beside it as `*.play.mp4` and is what the player signs
 * when it exists. Building it never blocks the signed-URL response — a
 * view that waits on ffmpeg is how the first Play click dies outside the
 * user gesture. Upload completion and the backfill script do the build.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from './errors.js';
import { contentTypeForProofPath } from './proofMediaType.js';

export const PROOF_PLAYABLE_BUCKET = 'job-proofs';
/** Sibling of an original — e.g. `…/clip.webm` → `…/clip.play.mp4`. */
export const PROOF_PLAYABLE_SUFFIX = '.play.mp4';
/**
 * Long enough for a viewing session, including scrubbing a workday film.
 * The player remints and resumes at the same currentTime if this lapses.
 */
export const PROOF_PLAYBACK_URL_TTL_SECONDS = 60 * 60;

const TRANSCODE_TIMEOUT_MS = Number(process.env.PROOF_PLAYABLE_FFMPEG_TIMEOUT_MS || 180_000);
const VIDEO_EXT = /\.(webm|mov|avi|m4v|mp4)$/i;

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

/**
 * True when `moov` sits ahead of `mdat` in the file head. A missing moov in
 * the first bytes means the index is at the end and the browser cannot
 * start (or seek) until the whole object downloads.
 */
export function mp4HeaderHasFastStart(head: Buffer): boolean {
  if (!head || head.length < 8) return false;
  const moov = head.indexOf(Buffer.from('moov'));
  if (moov < 0) return false;
  const mdat = head.indexOf(Buffer.from('mdat'));
  if (mdat < 0) return true;
  return moov < mdat;
}

/** Path of the playable derivative, or null when this object already is one. */
export function playableDerivativePath(storagePath: string): string | null {
  const path = String(storagePath ?? '').trim();
  if (!path || /\.play\.mp4$/i.test(path)) return null;
  if (!VIDEO_EXT.test(path)) return null;
  return path.replace(VIDEO_EXT, PROOF_PLAYABLE_SUFFIX);
}

export function needsPlayableDerivative(storagePath: string): boolean {
  return playableDerivativePath(storagePath) != null;
}

const inflight = new Map<string, Promise<string>>();
/** Originals we already proved are faststart MP4 — skip a repeat probe. */
const webReadyOriginals = new Set<string>();

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

async function readObjectHead(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-65535' } });
    if (!res.ok && res.status !== 206) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

const TRANSCODE_ARGS = [
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
];

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

  // An MP4 that already has moov at the front can play as-is. WebM / MOV /
  // AVI still need an H.264 sibling Safari can decode.
  if (/\.mp4$/i.test(input.sourcePath) && !/\.play\.mp4$/i.test(input.sourcePath)) {
    const head = await readObjectHead(signed.signedUrl);
    if (head && mp4HeaderHasFastStart(head)) {
      webReadyOriginals.add(input.sourcePath);
      return;
    }
  }

  const workDir = join(tmpdir(), `atm-play-${randomUUID()}`);
  await mkdir(workDir, { recursive: true });
  const outPath = join(workDir, 'play.mp4');
  try {
    const mustTranscode = /\.(webm|avi)$/i.test(input.sourcePath);
    let produced = false;
    if (!mustTranscode) {
      const copied = await runner(ffmpeg, [
        '-y',
        '-i',
        signed.signedUrl,
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        outPath,
      ]);
      produced = copied.code === 0;
    }
    if (!produced) {
      const { code, stderr } = await runner(ffmpeg, [
        '-y',
        '-i',
        signed.signedUrl,
        ...TRANSCODE_ARGS,
        outPath,
      ]);
      if (code !== 0) {
        throw new Error(stderr.slice(0, 500) || 'ffmpeg could not build a playable MP4.');
      }
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
 * Ensure a faststart H.264/AAC MP4 exists for this object.
 * Returns the derivative path, or the original when it is already web-ready.
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
  const original = String(input.storagePath ?? '').trim();
  const deriv = playableDerivativePath(original);
  if (!deriv) return original;
  if (webReadyOriginals.has(original)) return original;

  if (await storageHasObject(input.admin, bucket, deriv)) {
    return deriv;
  }

  let pending = inflight.get(deriv);
  if (!pending) {
    pending = buildPlayableDerivative({
      admin: input.admin,
      bucket,
      sourcePath: original,
      derivPath: deriv,
      runner: input.runner,
      ffmpegPath: input.ffmpegPath,
    })
      .then(() => (webReadyOriginals.has(original) ? original : deriv))
      .finally(() => {
        inflight.delete(deriv);
      });
    inflight.set(deriv, pending);
  }
  return pending;
}

/**
 * Mint a signed URL the office player can decode.
 *
 * Prefers an existing `.play.mp4`. Does not wait on ffmpeg unless
 * `awaitBuild` is set (upload backfill). `scheduleBuild` kicks the same
 * build in the background so the next view is fast without holding this one.
 *
 * The URL is the storage signed URL itself — the browser requests it with
 * Range and gets 206, which is what makes seeking instant.
 */
export async function createSignedPlayableProofUrl(input: {
  admin: SupabaseClient;
  storagePath: string;
  expiresInSeconds?: number;
  bucket?: string;
  runner?: ProofPlayableRunner;
  ffmpegPath?: string;
  /** Wait until the derivative exists (tests, backfill). Default: do not block. */
  awaitBuild?: boolean;
  /** When the derivative is missing, build it after this response. */
  scheduleBuild?: boolean;
}): Promise<{ url: string; storagePath: string; derived: boolean; expiresInSeconds: number; contentType: string }> {
  const bucket = input.bucket ?? PROOF_PLAYABLE_BUCKET;
  const expiresInSeconds = input.expiresInSeconds ?? PROOF_PLAYBACK_URL_TTL_SECONDS;
  const original = String(input.storagePath ?? '').trim();
  if (!original) {
    throw new HttpError(500, 'Proof has no storage path.', 'missing_storage_path');
  }

  let playPath = original;
  let derived = false;
  const deriv = playableDerivativePath(original);
  if (deriv && !webReadyOriginals.has(original)) {
    let exists = false;
    try {
      exists = await storageHasObject(input.admin, bucket, deriv);
    } catch {
      exists = false;
    }
    if (exists) {
      playPath = deriv;
      derived = true;
    } else if (input.awaitBuild) {
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
        console.warn(
          '[proofPlayableUrl] derivative failed; serving original:',
          err instanceof Error ? err.message : err,
        );
        playPath = original;
        derived = false;
      }
    } else if (input.scheduleBuild) {
      void ensurePlayableDerivative({
        admin: input.admin,
        storagePath: original,
        bucket,
        runner: input.runner,
        ffmpegPath: input.ffmpegPath,
      }).catch((err) => {
        console.warn(
          '[proofPlayableUrl] background derivative failed:',
          err instanceof Error ? err.message : err,
        );
      });
    }
  }

  const { data, error } = await input.admin.storage.from(bucket).createSignedUrl(playPath, expiresInSeconds);
  if (error || !data?.signedUrl) {
    throw new HttpError(500, error?.message ?? 'Could not mint a signed URL for playback.', 'signed_url_failed');
  }
  const contentType =
    (derived ? 'video/mp4' : contentTypeForProofPath(playPath)) ?? 'video/mp4';
  return { url: data.signedUrl, storagePath: playPath, derived, expiresInSeconds, contentType };
}
