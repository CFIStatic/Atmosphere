/**
 * FFmpeg-backed metadata and frame extraction.
 *
 * Handlers accept injectable runners so tests never need a real binary.
 */

import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verificationConfig } from '../config.js';
import type { PipelineContext } from '../pipeline/orchestrator.js';

export interface VideoMetadata {
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  codec: string | null;
  fps: number | null;
  rotate: number | null;
}

export interface ExtractedFrame {
  timestampSeconds: number;
  sequenceNumber: number;
  localPath: string;
  width: number | null;
  height: number | null;
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

export async function probeMetadata(
  filePath: string,
  runner: CommandRunner = defaultRunner,
): Promise<VideoMetadata> {
  const { stdout, code, stderr } = await runner(verificationConfig.ffprobePath, [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);
  if (code !== 0) throw new Error(`ffprobe failed: ${stderr.slice(0, 500)}`);
  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
      tags?: { rotate?: string };
    }>;
  };
  const video = parsed.streams?.find((s) => s.codec_type === 'video');
  let fps: number | null = null;
  if (video?.avg_frame_rate && video.avg_frame_rate.includes('/')) {
    const [a, b] = video.avg_frame_rate.split('/').map(Number);
    if (b) fps = a / b;
  }
  return {
    durationSeconds: parsed.format?.duration ? Number(parsed.format.duration) : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    codec: video?.codec_name ?? null,
    fps,
    rotate: video?.tags?.rotate ? Number(video.tags.rotate) : null,
  };
}

/**
 * Extract frames on an interval, optionally denser around scene changes.
 * Does not analyse every frame — caps at maxFramesPerVideo.
 */
export async function extractFrames(opts: {
  filePath: string;
  outDir: string;
  durationSeconds: number;
  intervalSeconds?: number;
  maxFrames?: number;
  sceneThreshold?: number;
  runner?: CommandRunner;
}): Promise<ExtractedFrame[]> {
  const runner = opts.runner ?? defaultRunner;
  const interval = opts.intervalSeconds ?? verificationConfig.frameIntervalSeconds;
  const maxFrames = opts.maxFrames ?? verificationConfig.maxFramesPerVideo;
  const sceneThreshold = opts.sceneThreshold ?? verificationConfig.sceneChangeThreshold;

  await mkdir(opts.outDir, { recursive: true });

  // Interval sampling via fps filter, plus scene-change selects when enabled.
  const filters = [`fps=1/${interval}`];
  if (verificationConfig.extractKeyframes) {
    filters.push(`select='gt(scene\\,${sceneThreshold})'`);
  }

  // Two-pass simplicity: even interval first (predictable, capped).
  const pattern = join(opts.outDir, 'frame_%05d.jpg');
  const fps = Math.max(1 / interval, 1 / 60);
  const { code, stderr } = await runner(verificationConfig.ffmpegPath, [
    '-y',
    '-i',
    opts.filePath,
    '-vf',
    `fps=${fps}`,
    '-q:v',
    '3',
    '-frames:v',
    String(maxFrames),
    pattern,
  ]);
  if (code !== 0) throw new Error(`ffmpeg extract failed: ${stderr.slice(0, 500)}`);

  const frames: ExtractedFrame[] = [];
  for (let i = 1; i <= maxFrames; i += 1) {
    const localPath = join(opts.outDir, `frame_${String(i).padStart(5, '0')}.jpg`);
    try {
      await readFile(localPath);
    } catch {
      break;
    }
    const timestampSeconds = Math.min((i - 1) * interval, Math.max(opts.durationSeconds - 0.1, 0));
    frames.push({
      timestampSeconds: Number(timestampSeconds.toFixed(3)),
      sequenceNumber: i - 1,
      localPath,
      width: null,
      height: null,
    });
  }
  return frames;
}

export async function extractThumbnail(opts: {
  filePath: string;
  outPath: string;
  atSeconds?: number;
  runner?: CommandRunner;
}): Promise<void> {
  const runner = opts.runner ?? defaultRunner;
  const at = opts.atSeconds ?? 1;
  const { code, stderr } = await runner(verificationConfig.ffmpegPath, [
    '-y',
    '-ss',
    String(at),
    '-i',
    opts.filePath,
    '-frames:v',
    '1',
    '-vf',
    `scale=${verificationConfig.thumbnailWidth}:-1`,
    opts.outPath,
  ]);
  if (code !== 0) throw new Error(`ffmpeg thumbnail failed: ${stderr.slice(0, 500)}`);
}

/** Pipeline stage: validate container via ffprobe after download. */
export function createValidateVideoHandler(opts?: {
  downloadVideo: (ctx: PipelineContext) => Promise<string>;
  runner?: CommandRunner;
}): (ctx: PipelineContext) => Promise<{ output: Record<string, unknown> }> {
  return async (ctx) => {
    const localPath = await (opts?.downloadVideo
      ? opts.downloadVideo(ctx)
      : downloadVideoToTemp(ctx));
    try {
      const meta = await probeMetadata(localPath, opts?.runner);
      if (meta.durationSeconds != null) {
        if (meta.durationSeconds < verificationConfig.minDurationSeconds) {
          throw new Error(`Video too short (${meta.durationSeconds}s)`);
        }
        if (meta.durationSeconds > verificationConfig.maxDurationSeconds) {
          throw new Error(`Video too long (${meta.durationSeconds}s)`);
        }
      }
      return { output: { valid: true, metadata: meta } };
    } finally {
      // leave file for later stages via config cache if downloadVideo manages lifecycle
      if (!opts?.downloadVideo) await rm(localPath, { force: true }).catch(() => undefined);
    }
  };
}

export async function downloadVideoToTemp(ctx: PipelineContext): Promise<string> {
  const { data: video, error } = await ctx.supabase
    .from('verification_videos')
    .select('storage_path')
    .eq('id', ctx.videoId)
    .single();
  if (error) throw new Error(error.message);

  const { data: blob, error: dlError } = await ctx.supabase.storage
    .from(verificationConfig.bucket)
    .download(video.storage_path);
  if (dlError || !blob) throw new Error(dlError?.message ?? 'Download failed');

  const dir = join(tmpdir(), `atm-verify-${ctx.videoId}`);
  await mkdir(dir, { recursive: true });
  const localPath = join(dir, 'original.bin');
  const buf = Buffer.from(await blob.arrayBuffer());
  await writeFile(localPath, buf);
  ctx.config._localVideoPath = localPath;
  ctx.config._workDir = dir;
  return localPath;
}

export function createExtractMetadataHandler(opts?: {
  runner?: CommandRunner;
}): (ctx: PipelineContext) => Promise<{ output: Record<string, unknown> }> {
  return async (ctx) => {
    const localPath =
      (ctx.config._localVideoPath as string | undefined) ?? (await downloadVideoToTemp(ctx));
    const meta = await probeMetadata(localPath, opts?.runner);
    await ctx.supabase
      .from('verification_videos')
      .update({
        duration_seconds: meta.durationSeconds,
        device_metadata: {
          ...(typeof ctx.config.deviceMetadata === 'object' ? ctx.config.deviceMetadata : {}),
          probe: meta,
        },
      })
      .eq('id', ctx.videoId);
    return { output: { metadata: meta } };
  };
}

export function createExtractFramesHandler(opts?: {
  runner?: CommandRunner;
  uploadFrame?: (
    ctx: PipelineContext,
    frame: ExtractedFrame,
    bytes: Buffer,
  ) => Promise<string>;
}): (ctx: PipelineContext) => Promise<{ output: Record<string, unknown>; digest: string }> {
  return async (ctx) => {
    const localPath =
      (ctx.config._localVideoPath as string | undefined) ?? (await downloadVideoToTemp(ctx));
    const workDir = (ctx.config._workDir as string) ?? join(tmpdir(), `atm-verify-${ctx.videoId}`);
    const frameDir = join(workDir, 'frames');

    const { data: video } = await ctx.supabase
      .from('verification_videos')
      .select('duration_seconds')
      .eq('id', ctx.videoId)
      .single();
    const duration = Number(video?.duration_seconds ?? 60);

    // Idempotent: skip re-insert when frames already exist for this video.
    const { count } = await ctx.supabase
      .from('verification_frames')
      .select('id', { count: 'exact', head: true })
      .eq('video_id', ctx.videoId);
    if ((count ?? 0) > 0) {
      return {
        output: { frameCount: count, reused: true },
        digest: createHash('sha256').update(`frames:${ctx.videoId}:${count}`).digest('hex').slice(0, 32),
      };
    }

    const extracted = await extractFrames({
      filePath: localPath,
      outDir: frameDir,
      durationSeconds: duration,
      runner: opts?.runner,
    });

    const rows = [];
    for (const frame of extracted) {
      const bytes = await readFile(frame.localPath);
      const storagePath =
        opts?.uploadFrame != null
          ? await opts.uploadFrame(ctx, frame, bytes)
          : await defaultUploadFrame(ctx, frame, bytes);
      rows.push({
        id: randomUUID(),
        org_id: ctx.orgId,
        video_id: ctx.videoId,
        timestamp_seconds: frame.timestampSeconds,
        sequence_number: frame.sequenceNumber,
        storage_path: storagePath,
        width: frame.width,
        height: frame.height,
        content_hash: createHash('sha256').update(bytes).digest('hex'),
        selected_for_analysis: false,
      });
    }

    if (rows.length) {
      const { error } = await ctx.supabase.from('verification_frames').insert(rows);
      if (error) throw new Error(error.message);
    }

    // Thumbnail
    try {
      const thumbPath = join(workDir, 'thumb.jpg');
      await extractThumbnail({ filePath: localPath, outPath: thumbPath, runner: opts?.runner });
      const thumbBytes = await readFile(thumbPath);
      const thumbStorage = `${ctx.orgId}/${ctx.jobId}/verification/${ctx.videoId}/thumb.jpg`;
      await ctx.supabase.storage
        .from(verificationConfig.bucket)
        .upload(thumbStorage, thumbBytes, { contentType: 'image/jpeg', upsert: true });
      await ctx.supabase
        .from('verification_videos')
        .update({ thumbnail_path: thumbStorage })
        .eq('id', ctx.videoId);
    } catch {
      // Thumbnail is best-effort.
    }

    return {
      output: { frameCount: rows.length },
      digest: createHash('sha256')
        .update(rows.map((r) => r.content_hash).join(','))
        .digest('hex')
        .slice(0, 32),
    };
  };
}

async function defaultUploadFrame(
  ctx: PipelineContext,
  frame: ExtractedFrame,
  bytes: Buffer,
): Promise<string> {
  const storagePath = `${ctx.orgId}/${ctx.jobId}/verification/${ctx.videoId}/frames/${String(frame.sequenceNumber).padStart(5, '0')}.jpg`;
  const { error } = await ctx.supabase.storage
    .from(verificationConfig.bucket)
    .upload(storagePath, bytes, { contentType: 'image/jpeg', upsert: true });
  if (error) throw new Error(error.message);
  return storagePath;
}
