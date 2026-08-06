/**
 * Sparse frame extraction for day-length (and overnight) recordings.
 *
 * A 24-hour phone file cannot ride into the API as base64 stills, and it
 * cannot be loaded whole into Node either. FFmpeg reads the signed storage
 * URL and writes a hard-capped set of JPEGs — one every N minutes — so the
 * long-form window reader has something honest to look at without ever
 * holding the video in RAM.
 */

import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

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
 * Evenly spaced sample times across a recording, hard-capped.
 *
 * Pure: same duration + knobs → same timestamps. Used by tests and by the
 * extractor so the planned times and the stored at_seconds agree.
 */
export function planSparseTimestamps(
  durationSeconds: number,
  opts: { intervalSeconds: number; maxFrames: number },
): number[] {
  const duration = Math.max(0, Number(durationSeconds) || 0);
  if (duration <= 0) return [];
  const interval = Math.max(1, Math.floor(opts.intervalSeconds));
  const maxFrames = Math.max(1, Math.floor(opts.maxFrames));

  // Prefer interval spacing; if that would exceed the budget, widen the gap
  // so a 24h file never produces more than maxFrames stills.
  const natural = Math.max(1, Math.floor(duration / interval));
  const count = Math.min(maxFrames, natural);
  if (count === 1) return [Math.min(duration * 0.5, duration)];

  const step = duration / count;
  const times: number[] = [];
  for (let i = 0; i < count; i += 1) {
    // Nudge off the exact ends — first/last moments are often a pocket or
    // a thumb over the lens.
    const at = Math.min(duration - 0.25, Math.max(0, step * (i + 0.5)));
    times.push(Math.round(at * 100) / 100);
  }
  return times;
}

/**
 * Cost / coverage math for operators: how many frames and windows a day of
 * a given length will produce under the current knobs.
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
  // Same grouping rule as segmentFrames, without importing to keep this
  // module free of config side effects in tests.
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
  return { frameCount: timestamps.length, approxWindows: windows, timestamps: timestamps.length ? timestamps : [lastAt] };
}

export async function extractSparseFramesFromUrl(input: {
  url: string;
  durationSeconds: number;
  intervalSeconds: number;
  maxFrames: number;
  ffmpegPath?: string;
  runner?: CommandRunner;
}): Promise<Array<{ atSeconds: number; jpeg: Buffer }>> {
  const runner = input.runner ?? defaultRunner;
  const ffmpeg = input.ffmpegPath ?? process.env.FFMPEG_PATH ?? 'ffmpeg';
  const timestamps = planSparseTimestamps(input.durationSeconds, {
    intervalSeconds: input.intervalSeconds,
    maxFrames: input.maxFrames,
  });
  if (!timestamps.length) return [];

  const workDir = join(tmpdir(), `atm-sparse-${randomUUID()}`);
  await mkdir(workDir, { recursive: true });
  try {
    // fps=1/N samples once per interval; -frames:v enforces the hard cap.
    // Input is a signed HTTPS URL — FFmpeg streams it; Node never holds the
    // multi‑GB file. Use a rational fps expression so 600s stays exact.
    const interval = Math.max(1, Math.floor(input.intervalSeconds));
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
    const out: Array<{ atSeconds: number; jpeg: Buffer }> = [];
    for (let i = 0; i < names.length; i += 1) {
      const at = timestamps[Math.min(i, timestamps.length - 1)] ?? i * input.intervalSeconds;
      out.push({ atSeconds: at, jpeg: await readFile(join(workDir, names[i])) });
    }
    return out;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
