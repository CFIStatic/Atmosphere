/**
 * Privacy-safe copy of a filed clip: the whole frame is blurred (and the
 * sound muted where the player mutes) through every child-privacy and
 * private-moment range, burned into the pixels.
 *
 * The in-app players blur on the client, but a downloaded file, a player
 * that does not know the ranges, or a still grabbed from the video would
 * otherwise carry the original bytes. Everything that hands out a clip with
 * ranges on file prefers this copy; a download never falls back to the
 * original. The original stays the filed object for hash and custody.
 *
 * The copy sits beside the original as `*.safe-<hash>.mp4`. The hash covers
 * the ranges, so a re-analysis that finds a new child builds a new copy
 * instead of serving a stale one.
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  childPrivacyRedactionsFromStored,
  childRangeMutesAudio,
} from '../audio/childPrivacyRedactions.js';
import { privacyRedactionsFromStored } from '../audio/privacyRedactions.js';
import { HttpError } from './errors.js';
import {
  PROOF_PLAYABLE_BUCKET,
  TRANSCODE_ARGS,
  defaultProofPlayableRunner,
  storageHasObject,
  type ProofPlayableRunner,
} from './proofPlayableUrl.js';

/** Blur a little before and after each range: ranges come from sparse stills. */
export const PRIVACY_SAFE_PAD_BEFORE_SEC = 1;
export const PRIVACY_SAFE_PAD_AFTER_SEC = 1.5;
/** Strong enough that a face or body cannot be made out at any frame size. */
const BLUR_SIGMA = 60;

export type PrivacyBlurWindow = { startSec: number; endSec: number; mute: boolean };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Every stretch of the clip that must not be seen: child ranges (boxed or
 * not, the copy blurs the whole frame) and private moments, padded and
 * merged. Empty when nothing is on file.
 */
export function privacyBlurWindows(aiFindings: unknown): PrivacyBlurWindow[] {
  const findings =
    aiFindings && typeof aiFindings === 'object' ? (aiFindings as Record<string, unknown>) : {};
  const raw: PrivacyBlurWindow[] = [
    ...privacyRedactionsFromStored(findings.privacyRedactions).map((r) => ({
      startSec: r.startSec,
      endSec: r.endSec,
      mute: true,
    })),
    ...childPrivacyRedactionsFromStored(findings.childPrivacyRedactions).map((r) => ({
      startSec: r.startSec,
      endSec: r.endSec,
      mute: childRangeMutesAudio(r),
    })),
  ]
    .map((w) => ({
      startSec: round2(Math.max(0, w.startSec - PRIVACY_SAFE_PAD_BEFORE_SEC)),
      endSec: round2(w.endSec + PRIVACY_SAFE_PAD_AFTER_SEC),
      mute: w.mute,
    }))
    .filter((w) => w.endSec > w.startSec)
    .sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
  const out: PrivacyBlurWindow[] = [];
  for (const w of raw) {
    const prev = out[out.length - 1];
    // Only merge windows with the same sound rule, so a boxed child range
    // never mutes a private moment's neighbor or vice versa.
    if (prev && w.startSec <= prev.endSec && prev.mute === w.mute) {
      prev.endSec = Math.max(prev.endSec, w.endSec);
      continue;
    }
    out.push({ ...w });
  }
  return out;
}

export function hasPrivacyBlur(aiFindings: unknown): boolean {
  return privacyBlurWindows(aiFindings).length > 0;
}

/** True when second `t` falls in a blur window. */
export function secondsInBlurWindow(t: number, windows: PrivacyBlurWindow[]): boolean {
  return windows.some((w) => t >= w.startSec && t <= w.endSec);
}

function windowsKey(windows: PrivacyBlurWindow[]): string {
  return createHash('sha1')
    .update(JSON.stringify(windows.map((w) => [w.startSec, w.endSec, w.mute ? 1 : 0])))
    .digest('hex')
    .slice(0, 12);
}

const VIDEO_EXT = /\.(webm|mov|avi|m4v|mp4)$/i;

/** `…/clip.webm` → `…/clip.safe-<hash>.mp4`; null when there is nothing to blur. */
export function privacySafePath(storagePath: string, windows: PrivacyBlurWindow[]): string | null {
  const path = String(storagePath ?? '').trim();
  if (!path || !windows.length) return null;
  const base = path.replace(/\.play\.mp4$/i, '').replace(VIDEO_EXT, '');
  return `${base}.safe-${windowsKey(windows)}.mp4`;
}

function enableExpr(windows: PrivacyBlurWindow[]): string {
  // Quoted so the commas inside between() are not read as filter separators.
  return `'${windows.map((w) => `between(t,${w.startSec},${w.endSec})`).join('+')}'`;
}

/** ffmpeg filter arguments that burn the blur (and mute) into the copy. */
export function privacySafeFilterArgs(windows: PrivacyBlurWindow[]): string[] {
  if (!windows.length) return [];
  const args = ['-vf', `gblur=sigma=${BLUR_SIGMA}:steps=3:enable=${enableExpr(windows)}`];
  const muted = windows.filter((w) => w.mute);
  if (muted.length) args.push('-af', `volume=volume=0:enable=${enableExpr(muted)}`);
  return args;
}

const inflight = new Map<string, Promise<void>>();

async function buildPrivacySafeCopy(input: {
  admin: SupabaseClient;
  bucket: string;
  sourcePath: string;
  safePath: string;
  windows: PrivacyBlurWindow[];
  runner?: ProofPlayableRunner;
  ffmpegPath?: string;
}): Promise<void> {
  const runner = input.runner ?? defaultProofPlayableRunner;
  const ffmpeg = input.ffmpegPath ?? process.env.FFMPEG_PATH ?? 'ffmpeg';
  const { data: signed, error: signErr } = await input.admin.storage
    .from(input.bucket)
    .createSignedUrl(input.sourcePath, 60 * 30);
  if (signErr || !signed?.signedUrl) {
    throw new HttpError(500, signErr?.message ?? 'Could not read the filed video.', 'signed_url_failed');
  }
  const workDir = join(tmpdir(), `atm-safe-${randomUUID()}`);
  await mkdir(workDir, { recursive: true });
  const outPath = join(workDir, 'safe.mp4');
  try {
    const { code, stderr } = await runner(ffmpeg, [
      '-y',
      '-i',
      signed.signedUrl,
      ...privacySafeFilterArgs(input.windows),
      ...TRANSCODE_ARGS,
      outPath,
    ]);
    if (code !== 0) throw new Error(stderr.slice(-500) || 'ffmpeg could not build the blurred copy.');
    const bytes = await readFile(outPath);
    if (!bytes.length) throw new Error('ffmpeg wrote an empty blurred copy.');
    const { error: upErr } = await input.admin.storage
      .from(input.bucket)
      .upload(input.safePath, bytes, { contentType: 'video/mp4', upsert: true });
    if (upErr) throw new HttpError(500, upErr.message, 'privacy_safe_upload_failed');
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Path of the blurred copy for this clip, building it when missing.
 * Null when the clip has nothing to blur. Concurrent callers share one build.
 */
export async function ensurePrivacySafeCopy(input: {
  admin: SupabaseClient;
  storagePath: string;
  aiFindings: unknown;
  bucket?: string;
  runner?: ProofPlayableRunner;
  ffmpegPath?: string;
}): Promise<string | null> {
  const bucket = input.bucket ?? PROOF_PLAYABLE_BUCKET;
  const windows = privacyBlurWindows(input.aiFindings);
  const safePath = privacySafePath(input.storagePath, windows);
  if (!safePath) return null;
  if (await storageHasObject(input.admin, bucket, safePath).catch(() => false)) return safePath;
  let pending = inflight.get(safePath);
  if (!pending) {
    pending = buildPrivacySafeCopy({
      admin: input.admin,
      bucket,
      sourcePath: String(input.storagePath).trim(),
      safePath,
      windows,
      runner: input.runner,
      ffmpegPath: input.ffmpegPath,
    }).finally(() => {
      inflight.delete(safePath);
    });
    inflight.set(safePath, pending);
  }
  await pending;
  return safePath;
}

/** Build the blurred copy after the response; failures are logged, never thrown. */
export function schedulePrivacySafeCopy(input: {
  admin: SupabaseClient;
  storagePath: string;
  aiFindings: unknown;
  bucket?: string;
}): void {
  if (!hasPrivacyBlur(input.aiFindings)) return;
  void ensurePrivacySafeCopy(input).catch((err) => {
    console.warn('[proofPrivacySafe] blurred copy failed:', err instanceof Error ? err.message : err);
  });
}

/**
 * The blurred copy's path when it already exists; schedules the build and
 * returns null when it does not. Null too when there is nothing to blur.
 */
export async function existingPrivacySafeCopy(input: {
  admin: SupabaseClient;
  storagePath: string;
  aiFindings: unknown;
  bucket?: string;
}): Promise<string | null> {
  const bucket = input.bucket ?? PROOF_PLAYABLE_BUCKET;
  const safePath = privacySafePath(input.storagePath, privacyBlurWindows(input.aiFindings));
  if (!safePath) return null;
  if (await storageHasObject(input.admin, bucket, safePath).catch(() => false)) return safePath;
  schedulePrivacySafeCopy({ ...input, bucket });
  return null;
}
