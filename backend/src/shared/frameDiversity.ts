/**
 * Keep frames that show different things.
 *
 * A chest-mount left on a sawhorse for three hours produces hundreds of
 * near-identical stills. Feeding those to the model wastes money and teaches
 * the dictation to narrate the same room over and over. This module scores
 * stills cheaply (no vision API) and keeps a diverse set: different enough
 * from what we already kept, while still covering the timeline.
 */

import { createHash } from 'node:crypto';

export type LuminanceSampler = (bytes: Buffer) => {
  width: number;
  height: number;
  /** 0–255 per pixel, row-major */
  pixels: Uint8Array;
};

/**
 * Lightweight sampler when no JPEG decoder is wired. Treats every 3rd byte
 * as luminance. Good enough for relative identity / change; not a colorimeter.
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

/** 64-bit average hash → 16 hex chars. */
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
  const avg = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
  let bits = '';
  for (const v of vals) bits += v >= avg ? '1' : '0';
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
    // Count set bits in nibble.
    dist += (x & 1) + ((x >> 1) & 1) + ((x >> 2) & 1) + ((x >> 3) & 1);
  }
  return dist;
}

export function contentFingerprint(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

export interface DiverseCandidate {
  atSeconds: number;
  jpeg: Buffer;
}

export interface DiverseFrame extends DiverseCandidate {
  perceptualHash: string;
  contentHash: string;
  /** Why this frame was kept (or would be useful in logs). */
  reason: 'first' | 'changed' | 'coverage';
}

export interface SelectDiverseOptions {
  maxFrames: number;
  /** Hamming distance that still counts as "the same picture". Default 8. */
  hammingThreshold?: number;
  /**
   * Even on a static camera, keep at least one frame every this many seconds
   * so the timeline does not go blank for hours. Those coverage keepers are
   * marked reason=coverage. Default 3600 (hourly).
   */
  coverageIntervalSeconds?: number;
  sampler?: LuminanceSampler;
}

/**
 * From a time-ordered candidate list, keep stills that look different.
 *
 * Rules, in order:
 *   1. Exact byte duplicates are always dropped.
 *   2. A candidate is kept when its perceptual hash is farther than the
 *      threshold from every already-kept frame (a real scene change).
 *   3. If nothing has changed for a long stretch, keep one coverage frame
 *      so the day still has temporal anchors — but never more than one per
 *      coverage interval while the picture stays the same.
 *   4. Hard-capped at maxFrames; if over budget, prefer changed over coverage.
 */
export function selectDiverseFrames(
  candidates: DiverseCandidate[],
  opts: SelectDiverseOptions,
): DiverseFrame[] {
  const maxFrames = Math.max(1, Math.floor(opts.maxFrames));
  const threshold = opts.hammingThreshold ?? 8;
  const coverageEvery = Math.max(60, opts.coverageIntervalSeconds ?? 3600);
  const sampler = opts.sampler ?? heuristicLuminanceSampler;

  const scored = candidates
    .map((c) => {
      const { width, height, pixels } = sampler(c.jpeg);
      return {
        atSeconds: c.atSeconds,
        jpeg: c.jpeg,
        perceptualHash: perceptualHash(width, height, pixels),
        contentHash: contentFingerprint(c.jpeg),
      };
    })
    .sort((a, b) => a.atSeconds - b.atSeconds);

  const kept: DiverseFrame[] = [];
  const seenContent = new Set<string>();
  let lastCoverageAt = -Infinity;

  for (const frame of scored) {
    const isFirst = kept.length === 0;
    const needsCoverage = frame.atSeconds - lastCoverageAt >= coverageEvery;
    const exactDup = seenContent.has(frame.contentHash);

    // Exact byte duplicates are dropped unless we need a coverage anchor —
    // a static hour still deserves one temporal pin, not silence.
    if (exactDup && !isFirst && !needsCoverage) continue;

    const differs =
      !exactDup &&
      kept.every((k) => hammingDistanceHex(k.perceptualHash, frame.perceptualHash) > threshold);

    if (isFirst) {
      kept.push({ ...frame, reason: 'first' });
      seenContent.add(frame.contentHash);
      lastCoverageAt = frame.atSeconds;
      continue;
    }
    if (differs) {
      kept.push({ ...frame, reason: 'changed' });
      seenContent.add(frame.contentHash);
      lastCoverageAt = frame.atSeconds;
      continue;
    }
    if (needsCoverage) {
      kept.push({ ...frame, reason: 'coverage' });
      seenContent.add(frame.contentHash);
      lastCoverageAt = frame.atSeconds;
    }
  }

  if (kept.length <= maxFrames) return kept;

  // Over budget: keep every "changed"/"first", then fill with evenly spaced
  // coverage frames. Never silently prefer duplicates over real changes.
  const changes = kept.filter((k) => k.reason !== 'coverage');
  if (changes.length >= maxFrames) {
    // Too many real changes — thin evenly across time.
    const step = changes.length / maxFrames;
    const out: DiverseFrame[] = [];
    for (let i = 0; i < maxFrames; i += 1) {
      out.push(changes[Math.min(changes.length - 1, Math.floor(i * step))]!);
    }
    return dedupeByTime(out);
  }
  const remaining = maxFrames - changes.length;
  const coverage = kept.filter((k) => k.reason === 'coverage');
  const step = coverage.length / remaining;
  const pickedCoverage: DiverseFrame[] = [];
  for (let i = 0; i < remaining && coverage.length; i += 1) {
    pickedCoverage.push(coverage[Math.min(coverage.length - 1, Math.floor(i * step))]!);
  }
  return dedupeByTime([...changes, ...pickedCoverage]).sort((a, b) => a.atSeconds - b.atSeconds);
}

function dedupeByTime(frames: DiverseFrame[]): DiverseFrame[] {
  const seen = new Set<number>();
  const out: DiverseFrame[] = [];
  for (const f of frames) {
    const key = Math.round(f.atSeconds * 100);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}
