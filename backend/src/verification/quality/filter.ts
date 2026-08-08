/**
 * Frame quality scoring and near-duplicate removal.
 *
 * Pure functions over pixel buffers so tests need no FFmpeg or AI.
 * Goal: drop ≥80% of frames before any model call without losing evidence of
 * meaningful work changes.
 */

import { createHash } from 'node:crypto';
import { verificationConfig } from '../config.js';
import type { FrameQualityScores } from '../types.js';
import type { PipelineContext } from '../pipeline/orchestrator.js';

export interface ScoredFrame {
  id: string;
  sequenceNumber: number;
  timestampSeconds: number;
  scores: FrameQualityScores;
  perceptualHash: string;
  rejected: boolean;
  rejectionReason: string | null;
  isDuplicate: boolean;
  duplicateOf: string | null;
  selectedForAnalysis: boolean;
}

/** Decode a grayscale luminance map from a raw RGB or JPEG-ish byte heuristic.
 * For production we prefer real decode; for pipeline purity we accept a
 * luminance sampler injected by the caller. */
export type LuminanceSampler = (bytes: Buffer) => {
  width: number;
  height: number;
  /** 0–255 per pixel, row-major */
  pixels: Uint8Array;
};

/**
 * Lightweight sampler that treats every 3rd byte as luminance when no decoder
 * is available. Good enough for relative blur/brightness and tests.
 */
export const heuristicLuminanceSampler: LuminanceSampler = (bytes) => {
  const sample = bytes.length > 200_000 ? bytes.subarray(0, 200_000) : bytes;
  const side = Math.max(8, Math.floor(Math.sqrt(sample.length / 3)));
  const pixels = new Uint8Array(side * side);
  for (let i = 0; i < pixels.length; i += 1) {
    const idx = Math.min(sample.length - 1, i * 3);
    pixels[i] = sample[idx]!;
  }
  return { width: side, height: side, pixels };
};

export function averageBrightness(pixels: Uint8Array): number {
  if (!pixels.length) return 0;
  let sum = 0;
  for (const p of pixels) sum += p;
  return sum / pixels.length / 255;
}

/** Laplacian variance proxy — higher means sharper. Normalized to 0–1 blur. */
export function blurScoreFromLaplacian(width: number, height: number, pixels: Uint8Array): number {
  if (width < 3 || height < 3) return 1;
  let varianceAcc = 0;
  let count = 0;
  const at = (x: number, y: number) => pixels[y * width + x] ?? 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const lap =
        -at(x - 1, y) - at(x + 1, y) - at(x, y - 1) - at(x, y + 1) + 4 * at(x, y);
      varianceAcc += lap * lap;
      count += 1;
    }
  }
  const variance = count ? varianceAcc / count : 0;
  // Empirically map: variance 0 → blur 1, variance ≥ 800 → blur 0.
  return Math.max(0, Math.min(1, 1 - variance / 800));
}

export function motionScoreBetween(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let diff = 0;
  for (let i = 0; i < n; i += 1) diff += Math.abs(a[i]! - b[i]!);
  return Math.min(1, diff / n / 255);
}

/** 64-bit perceptual hash (8×8 average hash). */
export function perceptualHash(width: number, height: number, pixels: Uint8Array): string {
  const size = 8;
  const blockW = Math.max(1, Math.floor(width / size));
  const blockH = Math.max(1, Math.floor(height / size));
  const vals: number[] = [];
  for (let by = 0; by < size; by += 1) {
    for (let bx = 0; bx < size; bx += 1) {
      let sum = 0;
      let count = 0;
      for (let y = by * blockH; y < (by + 1) * blockH && y < height; y += 1) {
        for (let x = bx * blockW; x < (bx + 1) * blockW && x < width; x += 1) {
          sum += pixels[y * width + x] ?? 0;
          count += 1;
        }
      }
      vals.push(count ? sum / count : 0);
    }
  }
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  let bits = '';
  for (const v of vals) bits += v >= avg ? '1' : '0';
  // Pack to hex
  let hex = '';
  for (let i = 0; i < 64; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

export function hammingDistanceHex(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let dist = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    dist += x.toString(2).replace(/0/g, '').length;
  }
  return dist;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function scoreFrameBytes(
  bytes: Buffer,
  previousPixels: Uint8Array | null,
  sampler: LuminanceSampler = heuristicLuminanceSampler,
): FrameQualityScores & { perceptualHash: string; pixels: Uint8Array; width: number; height: number } {
  const { width, height, pixels } = sampler(bytes);
  const brightness = averageBrightness(pixels);
  const blur = blurScoreFromLaplacian(width, height, pixels);
  const motion = previousPixels ? motionScoreBetween(previousPixels, pixels) : 0;
  const quality = Math.max(
    0,
    Math.min(1, (1 - blur) * 0.55 + (1 - Math.abs(brightness - 0.45) * 2) * 0.3 + (1 - motion) * 0.15),
  );
  return {
    qualityScore: Number(quality.toFixed(4)),
    blurScore: Number(blur.toFixed(4)),
    brightnessScore: Number(brightness.toFixed(4)),
    motionScore: Number(motion.toFixed(4)),
    perceptualHash: perceptualHash(width, height, pixels),
    pixels,
    width,
    height,
  };
}

export function selectFramesForAnalysis(
  scored: ScoredFrame[],
  opts?: { maxRatio?: number; maxCount?: number },
): ScoredFrame[] {
  const maxRatio = opts?.maxRatio ?? verificationConfig.targetAnalysisFrameRatio;
  const candidates = scored.filter((f) => !f.rejected && !f.isDuplicate);
  const budget = Math.max(
    1,
    Math.min(
      opts?.maxCount ?? verificationConfig.maxFramesPerVideo,
      Math.ceil(scored.length * maxRatio),
    ),
  );
  // Prefer higher quality, spaced across the timeline.
  const sorted = [...candidates].sort((a, b) => b.scores.qualityScore - a.scores.qualityScore);
  const picked: ScoredFrame[] = [];
  const minGap = Math.max(1, Math.floor(candidates.length / budget));
  for (const frame of sorted) {
    if (picked.length >= budget) break;
    if (picked.some((p) => Math.abs(p.sequenceNumber - frame.sequenceNumber) < minGap)) continue;
    picked.push(frame);
  }
  // Always keep first and last non-rejected if budget allows — bookends matter for temporal compare.
  for (const edge of [candidates[0], candidates[candidates.length - 1]]) {
    if (!edge) continue;
    if (picked.length >= budget) break;
    if (!picked.some((p) => p.id === edge.id)) picked.push(edge);
  }
  const selectedIds = new Set(picked.map((p) => p.id));
  return scored.map((f) => ({
    ...f,
    selectedForAnalysis: selectedIds.has(f.id) && !f.rejected && !f.isDuplicate,
  }));
}

export function createScoreFrameQualityHandler(opts?: {
  loadFrameBytes: (ctx: PipelineContext, storagePath: string) => Promise<Buffer>;
  sampler?: LuminanceSampler;
}): (ctx: PipelineContext) => Promise<{ output: Record<string, unknown> }> {
  return async (ctx) => {
    const { data: frames, error } = await ctx.supabase
      .from('verification_frames')
      .select('id, sequence_number, timestamp_seconds, storage_path')
      .eq('video_id', ctx.videoId)
      .order('sequence_number', { ascending: true });
    if (error) throw new Error(error.message);

    let prev: Uint8Array | null = null;
    let rejected = 0;
    for (const frame of frames ?? []) {
      const bytes = await opts!.loadFrameBytes(ctx, frame.storage_path);
      const scored = scoreFrameBytes(bytes, prev, opts?.sampler);
      prev = scored.pixels;

      let rejectionReason: string | null = null;
      if (scored.blurScore > verificationConfig.maxBlurScore) rejectionReason = 'blurry';
      else if (scored.brightnessScore < verificationConfig.minBrightness) rejectionReason = 'too_dark';
      else if (scored.brightnessScore > verificationConfig.maxBrightness) rejectionReason = 'overexposed';
      else if (scored.motionScore > verificationConfig.maxMotionScore) rejectionReason = 'motion_artifact';
      else if (scored.qualityScore < verificationConfig.minQualityScore) rejectionReason = 'low_quality';

      if (rejectionReason) rejected += 1;

      await ctx.supabase
        .from('verification_frames')
        .update({
          quality_score: scored.qualityScore,
          blur_score: scored.blurScore,
          brightness_score: scored.brightnessScore,
          motion_score: scored.motionScore,
          perceptual_hash: scored.perceptualHash,
          width: scored.width,
          height: scored.height,
          rejection_reason: rejectionReason,
          selected_for_analysis: false,
        })
        .eq('id', frame.id);
    }

    return { output: { scored: (frames ?? []).length, rejected } };
  };
}

export function createDeduplicateFramesHandler(): (
  ctx: PipelineContext,
) => Promise<{ output: Record<string, unknown> }> {
  return async (ctx) => {
    const { data: frames, error } = await ctx.supabase
      .from('verification_frames')
      .select(
        'id, sequence_number, timestamp_seconds, quality_score, blur_score, brightness_score, motion_score, perceptual_hash, rejection_reason',
      )
      .eq('video_id', ctx.videoId)
      .order('sequence_number', { ascending: true });
    if (error) throw new Error(error.message);

    const scored: ScoredFrame[] = (frames ?? []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (f: any) => ({
        id: f.id,
        sequenceNumber: f.sequence_number,
        timestampSeconds: Number(f.timestamp_seconds),
        scores: {
          qualityScore: Number(f.quality_score ?? 0),
          blurScore: Number(f.blur_score ?? 1),
          brightnessScore: Number(f.brightness_score ?? 0),
          motionScore: Number(f.motion_score ?? 0),
        },
        perceptualHash: f.perceptual_hash ?? '',
        rejected: Boolean(f.rejection_reason),
        rejectionReason: f.rejection_reason,
        isDuplicate: false,
        duplicateOf: null,
        selectedForAnalysis: false,
      }),
    );

    const kept: ScoredFrame[] = [];
    for (const frame of scored) {
      if (frame.rejected || !frame.perceptualHash) {
        kept.push(frame);
        continue;
      }
      const dupOf = kept.find(
        (k) =>
          !k.rejected &&
          k.perceptualHash &&
          hammingDistanceHex(k.perceptualHash, frame.perceptualHash) <=
            verificationConfig.duplicateHammingThreshold,
      );
      if (dupOf) {
        kept.push({ ...frame, isDuplicate: true, duplicateOf: dupOf.id });
      } else {
        kept.push(frame);
      }
    }

    const selected = selectFramesForAnalysis(kept);
    for (const frame of selected) {
      await ctx.supabase
        .from('verification_frames')
        .update({
          is_duplicate: frame.isDuplicate,
          duplicate_of: frame.duplicateOf,
          selected_for_analysis: frame.selectedForAnalysis,
        })
        .eq('id', frame.id);
    }

    const selectedCount = selected.filter((f) => f.selectedForAnalysis).length;
    const reduction =
      scored.length === 0 ? 0 : 1 - selectedCount / scored.length;

    return {
      output: {
        total: scored.length,
        duplicates: selected.filter((f) => f.isDuplicate).length,
        selected: selectedCount,
        reductionRatio: Number(reduction.toFixed(4)),
      },
    };
  };
}

export function embeddingRef(hash: string): string {
  return createHash('sha256').update(`emb:${hash}`).digest('hex').slice(0, 16);
}
