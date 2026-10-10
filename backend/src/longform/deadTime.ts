/**
 * Cheap, deterministic signals for "dead" stretches. These never remove
 * footage from the timeline: they only label it (driving, pocket, silence,
 * break) and tell the deep layer where not to spend.
 */

export type DeadLabel = 'driving' | 'pocket' | 'silence' | 'static' | null;

export type FrameSignal = {
  atSeconds: number;
  /** Mean luma 0-255 (ffmpeg signalstats YAVG). */
  luma?: number | null;
  /** Mean abs difference to the previous frame 0-255. */
  diff?: number | null;
  /** Audio RMS dBFS around this frame. */
  rmsDb?: number | null;
  /** Device GPS speed m/s, when the recording carries it. */
  speedMps?: number | null;
};

export const DEAD_THRESHOLDS = {
  darkLuma: 18,
  silenceDb: -50,
  drivingMps: 6,
  staticDiff: 1.5,
};

/** One frame's dead label from signals alone. Conservative: unknown → null (treated as live). */
export function classifyFrameSignal(s: FrameSignal): DeadLabel {
  if (s.speedMps != null && s.speedMps >= DEAD_THRESHOLDS.drivingMps) return 'driving';
  if (s.luma != null && s.luma < DEAD_THRESHOLDS.darkLuma) return 'pocket';
  const silent = s.rmsDb != null && s.rmsDb <= DEAD_THRESHOLDS.silenceDb;
  const still = s.diff != null && s.diff <= DEAD_THRESHOLDS.staticDiff;
  if (silent && still) return 'static';
  if (silent) return 'silence';
  return null;
}

/** Parse `ffmpeg ... signalstats,metadata=print` stderr/stdout into luma per frame. */
export function parseSignalstats(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/lavfi\.signalstats\.YAVG=([0-9.]+)/g)) out.push(Number(m[1]));
  return out;
}

/** Parse `astats=metadata=1:reset=N,ametadata=print` RMS levels. */
export function parseAstatsRms(text: string): Array<{ t: number; db: number }> {
  const out: Array<{ t: number; db: number }> = [];
  let t = 0;
  for (const line of text.split('\n')) {
    const pts = /pts_time:([0-9.]+)/.exec(line);
    if (pts) t = Number(pts[1]);
    const rms = /lavfi\.astats\.Overall\.RMS_level=(-?[0-9.]+|-inf)/.exec(line);
    if (rms) out.push({ t, db: rms[1] === '-inf' ? -120 : Number(rms[1]) });
  }
  return out;
}
