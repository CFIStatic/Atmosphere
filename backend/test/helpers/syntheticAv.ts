/**
 * Build short synthetic MP4s with H.264 + AAC so pipeline tests do not need
 * real field footage. Requires ffmpeg on PATH.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** True when ffmpeg (or FFMPEG_PATH) can be spawned. */
export function ffmpegAvailable(): boolean {
  const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg';
  try {
    const result = spawnSync(ffmpeg, ['-version'], {
      stdio: 'ignore',
      timeout: 5_000,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

async function run(bin: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += String(d);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${bin} failed (${code}): ${stderr.slice(0, 400)}`));
    });
  });
}

export type SyntheticClip = {
  path: string;
  durationSeconds: number;
  hasAudio: boolean;
  hasVideo: boolean;
};

/**
 * testsrc pattern + optional sine tone — proves A/V mux and sparse extract
 * without any crew footage.
 */
export async function makeSyntheticDayClip(opts?: {
  durationSeconds?: number;
  outDir?: string;
  name?: string;
  withAudio?: boolean;
}): Promise<SyntheticClip> {
  const durationSeconds = opts?.durationSeconds ?? 12;
  const withAudio = opts?.withAudio !== false;
  const dir = opts?.outDir ?? join(tmpdir(), 'atm-synthetic-av');
  await mkdir(dir, { recursive: true });
  const path = join(dir, opts?.name ?? `clip-${durationSeconds}s-${withAudio ? 'av' : 'v'}.mp4`);

  try {
    await access(path);
    return { path, durationSeconds, hasAudio: withAudio, hasVideo: true };
  } catch {
    /* generate below */
  }

  const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg';
  const args = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `testsrc=duration=${durationSeconds}:size=640x360:rate=15`,
  ];
  if (withAudio) {
    args.push('-f', 'lavfi', '-i', `sine=frequency=880:duration=${durationSeconds}`);
  }
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart');
  if (withAudio) {
    args.push('-c:a', 'aac', '-b:a', '64k', '-shortest');
  }
  args.push(path);

  await run(ffmpeg, args);
  return { path, durationSeconds, hasAudio: withAudio, hasVideo: true };
}

/** Stream info via ffmpeg -i (ffprobe not required). */
export async function probeHasAudio(filePath: string): Promise<boolean> {
  const stderr = await ffmpegIdentify(filePath);
  return /Audio:\s*\w+/i.test(stderr);
}

export async function probeHasVideo(filePath: string): Promise<boolean> {
  const stderr = await ffmpegIdentify(filePath);
  return /Video:\s*\w+/i.test(stderr);
}

function ffmpegIdentify(filePath: string): Promise<string> {
  const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg';
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-i', filePath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += String(d);
    });
    child.on('error', reject);
    child.on('close', () => resolve(stderr));
  });
}
