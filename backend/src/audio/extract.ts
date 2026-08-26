/**
 * Pull a short audio slice from a filed day film without loading the video
 * into Node. FFmpeg seeks over the signed URL (or a local path) and writes
 * 16 kHz mono WAV — the shape Whisper-class endpoints expect.
 */

import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';

export type CommandRunner = (
  bin: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string; code: number }>;

export const defaultAudioRunner: CommandRunner = (bin, args) =>
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

export type AudioProbe = {
  hasAudio: boolean;
  durationSeconds: number | null;
  codec: string | null;
};

export async function probeAudioTrack(
  source: string,
  runner: CommandRunner = defaultAudioRunner,
): Promise<AudioProbe> {
  const ffprobe = process.env.FFPROBE_PATH ?? 'ffprobe';
  const { stdout, code, stderr } = await runner(ffprobe, [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    '-select_streams',
    'a',
    source,
  ]);
  if (code !== 0) throw new Error(`ffprobe audio failed: ${stderr.slice(0, 400)}`);
  const parsed = JSON.parse(stdout || '{}') as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; codec_name?: string }>;
  };
  const audio = parsed.streams?.find((s) => s.codec_type === 'audio') ?? parsed.streams?.[0];
  return {
    hasAudio: Boolean(audio),
    durationSeconds: parsed.format?.duration ? Number(parsed.format.duration) : null,
    codec: audio?.codec_name ?? null,
  };
}

export async function extractAudioChunk(opts: {
  source: string;
  startSeconds: number;
  durationSeconds: number;
  outPath: string;
  runner?: CommandRunner;
}): Promise<void> {
  const runner = opts.runner ?? defaultAudioRunner;
  const ffmpeg = process.env.FFMPEG_PATH ?? config.verification.ffmpegPath ?? 'ffmpeg';
  const { code, stderr } = await runner(ffmpeg, [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    String(opts.startSeconds),
    '-t',
    String(opts.durationSeconds),
    '-i',
    opts.source,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'pcm_s16le',
    '-f',
    'wav',
    opts.outPath,
  ]);
  if (code !== 0) throw new Error(`ffmpeg extract audio failed: ${stderr.slice(0, 400)}`);
}

export async function withAudioWorkDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = join(tmpdir(), `atm-audio-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
