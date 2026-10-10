/**
 * Switches for the long-recording base timeline. All OFF by default:
 * nothing here runs, enqueues or calls a model unless VIDEO_BASE_TIMELINE=true.
 */

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const baseTimelineFlags = {
  /** Master switch: enqueue segment jobs and run the worker. */
  enabled: () => process.env.VIDEO_BASE_TIMELINE === 'true',
  /** Segment length for resumable jobs (seconds). */
  segmentSeconds: () => num('VIDEO_SEGMENT_SECONDS', 600),
  /** One keyframe caption every N seconds across ALL footage. */
  captionIntervalSeconds: () => num('VIDEO_CAPTION_INTERVAL_SECONDS', 15),
  /** Frames per caption call. */
  captionBatch: () => Math.min(24, Math.floor(num('VIDEO_CAPTION_BATCH', 12))),
  captionModel: () => (process.env.VIDEO_CAPTION_MODEL ?? '').trim() || 'gemini-3.5-flash-lite',
  rereadModel: () => (process.env.VIDEO_CAPTION_REREAD_MODEL ?? '').trim() || 'gemini-3.8-flash',
  /** Captions below this confidence are re-read once by rereadModel. 0 = never. */
  rereadBelow: () => {
    const v = Number(process.env.VIDEO_CAPTION_REREAD_BELOW ?? '0.6');
    return Number.isFinite(v) && v >= 0 ? v : 0.6;
  },
  /** Keyframe width in px (low-res keeps captions cheap). */
  frameWidth: () => num('VIDEO_CAPTION_FRAME_WIDTH', 512),
  maxAttempts: () => num('VIDEO_SEGMENT_MAX_ATTEMPTS', 5),
};
