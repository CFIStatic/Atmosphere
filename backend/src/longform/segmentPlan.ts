/** Pure planning for resumable segment jobs and caption timestamps. */

export type SegmentPlan = { index: number; startSeconds: number; endSeconds: number };

/** Contiguous, gap-free segments covering [0, duration). */
export function planSegments(durationSeconds: number, segmentSeconds: number): SegmentPlan[] {
  const total = Math.max(0, Number(durationSeconds) || 0);
  const size = Math.max(1, segmentSeconds);
  const out: SegmentPlan[] = [];
  for (let start = 0, i = 0; start < total; start += size, i += 1) {
    out.push({ index: i, startSeconds: start, endSeconds: Math.min(total, start + size) });
  }
  return out;
}

/**
 * Caption timestamps inside one segment: every `interval` seconds from the
 * segment start, plus the segment midpoint when the segment is shorter than
 * one interval, so no stretch of footage goes without a frame.
 */
export function captionTimes(seg: { startSeconds: number; endSeconds: number }, interval: number): number[] {
  const step = Math.max(1, interval);
  const out: number[] = [];
  for (let t = seg.startSeconds; t < seg.endSeconds; t += step) out.push(Math.round(t * 100) / 100);
  if (!out.length && seg.endSeconds > seg.startSeconds) out.push((seg.startSeconds + seg.endSeconds) / 2);
  return out;
}
