/**
 * Sparse, diversity-aware frame extraction for day-length recordings.
 *
 * A 24-hour phone file cannot ride into the API as base64 stills, and it
 * cannot be loaded whole into Node either. FFmpeg reads the signed storage
 * URL and writes candidate JPEGs; we then keep only stills that look
 * different (perceptual hash) so a static camera does not waste the model
 * budget on the same frame for hours.
 */

import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { selectDiverseFrames } from './frameDiversity.js';

/**
 * Where a list thumbnail should come from on the timeline.
 *
 * The first frame of a phone recording is usually a thumb over the lens or a
 * black settle. A quarter of the way in is far enough to be the work and
 * early enough to still be a "preview" of the clip.
 */
export function previewAtSeconds(durationSeconds?: number | null): number {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) return 0.5;
  if (duration <= 1) return Math.round(duration * 50) / 100;
  return Math.round(Math.min(duration * 0.25, duration - 0.25) * 100) / 100;
}

/**
 * The still that should represent a clip in a list: closest to the preview
 * timestamp, so a stack of device frames or a sparse workday sample both
 * pick something that looks like the video rather than the opening.
 */
export function pickPreviewFrame<T extends { atSeconds: number }>(
  frames: T[],
  durationSeconds?: number | null,
): T | null {
  if (!frames.length) return null;
  const sorted = [...frames].sort((a, b) => a.atSeconds - b.atSeconds);
  const target = previewAtSeconds(durationSeconds);
  let best = sorted[0]!;
  let bestDist = Math.abs(best.atSeconds - target);
  for (const frame of sorted) {
    const dist = Math.abs(frame.atSeconds - target);
    if (dist < bestDist) {
      best = frame;
      bestDist = dist;
    }
  }
  return best;
}

export type CommandRunner = (
  bin: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string; code: number }>;

export const defaultRunner: CommandRunner = (bin, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += String(d);
    });
    child.stderr.on('data', (d) => {
      stderr += String(d);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? 1 }));
  });

/**
 * Candidate sample times — denser than the final keep budget so diversity
 * filtering has something to choose from.
 */
export function planSparseTimestamps(
  durationSeconds: number,
  opts: { intervalSeconds: number; maxFrames: number },
): number[] {
  const duration = Math.max(0, Number(durationSeconds) || 0);
  if (duration <= 0) return [];
  const interval = Math.max(1, Math.floor(opts.intervalSeconds));
  const maxFrames = Math.max(1, Math.floor(opts.maxFrames));

  const natural = Math.max(1, Math.floor(duration / interval));
  const count = Math.min(maxFrames, natural);
  if (count === 1) return [Math.min(duration * 0.5, duration)];

  const step = duration / count;
  const times: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const at = Math.min(duration - 0.25, Math.max(0, step * (i + 0.5)));
    times.push(Math.round(at * 100) / 100);
  }
  return times;
}

/**
 * Cost / coverage math for operators after diversity filtering.
 */
export function longFormBudget(input: {
  durationSeconds: number;
  intervalSeconds: number;
  maxFrames: number;
  windowMaxFrames: number;
  windowMaxSeconds: number;
}): { frameCount: number; approxWindows: number; timestamps: number[] } {
  const timestamps = planSparseTimestamps(input.durationSeconds, {
    intervalSeconds: input.intervalSeconds,
    maxFrames: input.maxFrames,
  });
  let windows = 0;
  let start = 0;
  let lastAt = 0;
  let n = 0;
  for (const at of timestamps) {
    if (n && (n >= input.windowMaxFrames || at - start > input.windowMaxSeconds)) {
      windows += 1;
      n = 0;
    }
    if (!n) start = at;
    n += 1;
    lastAt = at;
  }
  if (n) windows += 1;
  return {
    frameCount: timestamps.length,
    approxWindows: windows,
    timestamps: timestamps.length ? timestamps : [lastAt],
  };
}

export async function extractSparseFramesFromUrl(input: {
  url: string;
  durationSeconds: number;
  /** Final keep budget after diversity filtering. */
  maxFrames: number;
  /**
   * Spacing for candidate stills before diversity. Defaults to denser than
   * the keep budget (e.g. every 2 minutes) so we can drop near-duplicates.
   */
  candidateIntervalSeconds?: number;
  hammingThreshold?: number;
  coverageIntervalSeconds?: number;
  ffmpegPath?: string;
  runner?: CommandRunner;
}): Promise<Array<{ atSeconds: number; jpeg: Buffer; reason?: string }>> {
  const runner = input.runner ?? defaultRunner;
  const ffmpeg = input.ffmpegPath ?? process.env.FFMPEG_PATH ?? 'ffmpeg';
  const maxFrames = Math.max(1, Math.floor(input.maxFrames));
  const duration = Math.max(0, Number(input.durationSeconds) || 0);
  // Oversample ~3× the keep budget. Floor at 60s for long days so we do not
  // explode candidates — but never exceed half the clip length, or a short
  // guided video (or synthetic fixture) yields zero JPEGs from fps=1/60.
  const preferred = Math.floor(
    input.candidateIntervalSeconds
      ?? Math.max(60, Math.floor((duration || 1) / (maxFrames * 3))),
  );
  const candidateInterval = Math.max(
    1,
    Math.min(Math.max(1, preferred), Math.max(1, Math.floor(duration / 2) || 1)),
  );
  // Hard cap candidates so a 24h file at 60s never means 1440 JPEGs on disk.
  const maxCandidates = Math.min(720, Math.max(maxFrames * 4, maxFrames));
  const timestamps = planSparseTimestamps(input.durationSeconds, {
    intervalSeconds: candidateInterval,
    maxFrames: maxCandidates,
  });
  if (!timestamps.length) return [];

  const workDir = join(tmpdir(), `atm-sparse-${randomUUID()}`);
  await mkdir(workDir, { recursive: true });
  try {
    const interval = Math.max(1, candidateInterval);
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      input.url,
      '-vf',
      `fps=1/${interval}`,
      '-frames:v',
      String(timestamps.length),
      '-q:v',
      '5',
      join(workDir, 'frame_%04d.jpg'),
    ];
    const { code, stderr } = await runner(ffmpeg, args);
    if (code !== 0) {
      throw new Error(`ffmpeg sparse extract failed: ${stderr.slice(0, 500)}`);
    }

    const names = (await readdir(workDir))
      .filter((n) => n.endsWith('.jpg'))
      .sort();
    const candidates: Array<{ atSeconds: number; jpeg: Buffer }> = [];
    for (let i = 0; i < names.length; i += 1) {
      const at = timestamps[Math.min(i, timestamps.length - 1)] ?? i * interval;
      candidates.push({ atSeconds: at, jpeg: await readFile(join(workDir, names[i])) });
    }

    const diverse = selectDiverseFrames(candidates, {
      maxFrames,
      hammingThreshold: input.hammingThreshold,
      coverageIntervalSeconds: input.coverageIntervalSeconds,
    });
    return diverse.map((f) => ({
      atSeconds: f.atSeconds,
      jpeg: f.jpeg,
      reason: f.reason,
    }));
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * One JPEG for a library thumbnail. Seeks to the preview timestamp so the
 * list does not show the first (often black) frame. Falls back to the
 * opening if the seek overshoots a short clip.
 *
 * FFmpeg reads the signed URL — Node never holds the video.
 */
export async function extractPreviewFrameFromUrl(input: {
  url: string;
  durationSeconds?: number | null;
  atSeconds?: number;
  width?: number;
  ffmpegPath?: string;
  runner?: CommandRunner;
}): Promise<{ atSeconds: number; jpeg: Buffer }> {
  const runner = input.runner ?? defaultRunner;
  const ffmpeg = input.ffmpegPath ?? process.env.FFMPEG_PATH ?? 'ffmpeg';
  const at = input.atSeconds ?? previewAtSeconds(input.durationSeconds);
  const width = Math.max(64, Math.floor(input.width ?? 480));
  const workDir = join(tmpdir(), `atm-preview-${randomUUID()}`);
  await mkdir(workDir, { recursive: true });
  const outPath = join(workDir, 'preview.jpg');

  const argsFor = (seek: number | null) => {
    const args = ['-y', '-hide_banner', '-loglevel', 'error'];
    if (seek != null && seek > 0) {
      args.push('-ss', String(seek));
    }
    args.push(
      '-i',
      input.url,
      '-frames:v',
      '1',
      '-vf',
      `scale=${width}:-1`,
      '-q:v',
      '5',
      outPath,
    );
    return args;
  };

  try {
    let usedAt = Math.max(0, at);
    let { code, stderr } = await runner(ffmpeg, argsFor(usedAt));
    if (code !== 0 || !(await fileHasBytes(outPath))) {
      usedAt = 0;
      ({ code, stderr } = await runner(ffmpeg, argsFor(null)));
    }
    if (code !== 0) {
      throw new Error(`ffmpeg preview failed: ${stderr.slice(0, 500)}`);
    }
    const jpeg = await readFile(outPath);
    if (!jpeg.length) throw new Error('ffmpeg preview produced an empty file');
    return { atSeconds: usedAt, jpeg };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function fileHasBytes(path: string): Promise<boolean> {
  try {
    const buf = await readFile(path);
    return buf.length > 0;
  } catch {
    return false;
  }
}
