/**
 * The full-coverage base timeline: one entry for EVERY minute of footage,
 * built from keyframe captions, the timed transcript and dead-time signals.
 * Dead stretches are labelled and merged into ranges ("driving 2:10–2:40"),
 * never skipped. Pure: no I/O.
 */

import type { FrameCaption } from './captions.js';
import type { DeadLabel } from './deadTime.js';

export type TimedLine = { start: number; end: number; text: string; speaker?: string | null };

export type TimelineEntry = {
  startSeconds: number;
  endSeconds: number;
  label: string;
  activity: string;
  room: string | null;
  speech: string | null;
  dead: Exclude<DeadLabel, null> | null;
  /** What this entry is built from. 'none' = no frame and no speech (a visible gap, never hidden). */
  sources: Array<'caption' | 'transcript' | 'signal' | 'none'>;
  confidence: number;
};

const DEAD_ACTIVITIES = new Set(['driving', 'break', 'pocket_or_dark', 'idle']);

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

function mode<T>(items: T[]): T | null {
  const counts = new Map<T, number>();
  for (const x of items) counts.set(x, (counts.get(x) ?? 0) + 1);
  let best: T | null = null;
  let n = 0;
  for (const [k, v] of counts) if (v > n) [best, n] = [k, v];
  return best;
}

function deadFromActivity(activity: string): Exclude<DeadLabel, null> | null {
  if (activity === 'driving') return 'driving';
  if (activity === 'pocket_or_dark') return 'pocket';
  if (activity === 'break' || activity === 'idle') return 'static';
  return null;
}

/** One entry per minute (the last may be shorter). Speech always wins over a dead label. */
export function buildMinuteTimeline(input: {
  durationSeconds: number;
  captions: FrameCaption[];
  transcript: TimedLine[];
  signals?: Array<{ atSeconds: number; dead: DeadLabel }>;
  minuteSeconds?: number;
}): TimelineEntry[] {
  const total = Math.max(0, input.durationSeconds);
  const step = input.minuteSeconds ?? 60;
  const out: TimelineEntry[] = [];
  for (let start = 0; start < total; start += step) {
    const end = Math.min(total, start + step);
    const caps = input.captions.filter((c) => c.atSeconds >= start && c.atSeconds < end && c.status !== 'unread');
    const lines = input.transcript.filter((l) => l.end > start && l.start < end && l.text.trim());
    const sigs = (input.signals ?? []).filter((s) => s.atSeconds >= start && s.atSeconds < end);
    const speech = lines.length ? lines.map((l) => (l.speaker ? `${l.speaker}: ` : '') + l.text.trim()).join(' ').slice(0, 400) : null;
    const activity = mode(caps.map((c) => c.activity)) ?? (speech ? 'talking' : 'other');
    const sigDead = mode(sigs.map((s) => s.dead).filter((d): d is Exclude<DeadLabel, null> => d != null));
    const capsDead = caps.length && caps.every((c) => DEAD_ACTIVITIES.has(c.activity)) ? deadFromActivity(activity) : null;
    const dead = speech ? null : (capsDead ?? (caps.length ? null : sigDead ?? null));
    const sources: TimelineEntry['sources'] = [];
    if (caps.length) sources.push('caption');
    if (lines.length) sources.push('transcript');
    if (sigs.length && dead) sources.push('signal');
    if (!sources.length) sources.push('none');
    const best = caps.slice().sort((a, b) => b.confidence - a.confidence)[0];
    const label = best
      ? best.caption
      : speech
        ? 'Talking (no clear frame).'
        : dead
          ? `${dead === 'pocket' ? 'Camera covered or dark' : dead === 'static' ? 'No movement, no speech' : dead === 'silence' ? 'Silence' : 'Driving'}.`
          : 'Nothing captured for this minute.';
    out.push({
      startSeconds: start,
      endSeconds: end,
      label,
      activity,
      room: mode(caps.map((c) => c.room).filter((r): r is string => !!r)),
      speech,
      dead,
      sources,
      confidence: caps.length ? caps.reduce((a, c) => a + c.confidence, 0) / caps.length : speech ? 0.5 : 0,
    });
  }
  return out;
}

/** Merge consecutive dead minutes with the same label into one range for display. */
export function collapseDeadRanges(entries: TimelineEntry[]): Array<TimelineEntry & { range: string }> {
  const out: Array<TimelineEntry & { range: string }> = [];
  for (const e of entries) {
    const prev = out[out.length - 1];
    if (prev && e.dead && prev.dead === e.dead && prev.endSeconds === e.startSeconds) {
      prev.endSeconds = e.endSeconds;
      prev.range = `${prev.dead} ${formatClock(prev.startSeconds)}–${formatClock(prev.endSeconds)}`;
      continue;
    }
    out.push({ ...e, range: e.dead ? `${e.dead} ${formatClock(e.startSeconds)}–${formatClock(e.endSeconds)}` : `${formatClock(e.startSeconds)}–${formatClock(e.endSeconds)}` });
  }
  return out;
}

/** Coverage = share of minutes with an entry that is backed by a caption or speech. */
export function timelineCoverage(entries: TimelineEntry[], durationSeconds: number, minuteSeconds = 60): {
  minutes: number;
  covered: number;
  gaps: number[];
  pct: number;
} {
  const minutes = Math.ceil(Math.max(0, durationSeconds) / minuteSeconds);
  const gaps: number[] = [];
  let covered = 0;
  for (let i = 0; i < minutes; i += 1) {
    const e = entries.find((x) => x.startSeconds === i * minuteSeconds);
    if (e && !e.sources.includes('none')) covered += 1;
    else gaps.push(i);
  }
  return { minutes, covered, gaps, pct: minutes ? (covered / minutes) * 100 : 100 };
}
