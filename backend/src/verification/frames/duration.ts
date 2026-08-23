/**
 * Duration from a probe — not from the device.
 *
 * MediaRecorder WebM (and some phone muxers) omit format.duration. The
 * browser then uploads 0, and the office list prints 0:00. The length is
 * still in the file: a stream duration, a Matroska DURATION tag, or the
 * last packet timestamp. This module is the one place those shapes are
 * read, so the list, the length check, and retention agree.
 */

export type ProbeJson = {
  format?: {
    duration?: string | number;
    tags?: Record<string, string | undefined>;
  };
  streams?: Array<{
    codec_type?: string;
    duration?: string | number;
    tags?: Record<string, string | undefined>;
  }>;
};

/** Positive finite seconds, or null when the value is missing / unusable. */
export function parseMediaDuration(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || /^n\/?a$/i.test(trimmed)) return null;

  // Matroska / WebM tags: "00:02:23.123456789" or "2:23.1"
  const sexagesimal = trimmed.match(/^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/);
  if (sexagesimal) {
    const hours = Number(sexagesimal[1] ?? 0);
    const minutes = Number(sexagesimal[2]);
    const seconds = Number(sexagesimal[3]);
    const total = hours * 3600 + minutes * 60 + seconds;
    return Number.isFinite(total) && total > 0 ? total : null;
  }

  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function tagDuration(tags: Record<string, string | undefined> | undefined): unknown[] {
  if (!tags) return [];
  return [tags.DURATION, tags.Duration, tags.duration];
}

/**
 * Longest positive duration advertised in an ffprobe JSON document.
 * Stream and tag values win over a missing format.duration — the usual
 * MediaRecorder case.
 */
export function durationFromProbe(parsed: ProbeJson): number | null {
  const candidates: unknown[] = [
    parsed.format?.duration,
    ...tagDuration(parsed.format?.tags),
  ];
  for (const stream of parsed.streams ?? []) {
    candidates.push(stream.duration, ...tagDuration(stream.tags));
  }
  let best: number | null = null;
  for (const value of candidates) {
    const n = parseMediaDuration(value);
    if (n != null && (best == null || n > best)) best = n;
  }
  return best;
}

/** Last positive timestamp from `ffprobe -show_entries packet=pts_time`. */
export function durationFromPacketTimes(stdout: string): number | null {
  let best: number | null = null;
  for (const token of stdout.split(/[\s,]+/)) {
    if (!token) continue;
    const n = Number(token);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (best == null || n > best) best = n;
  }
  return best;
}

/** Clock form the office list prints: `1:50`, `1:17:00`. Null when unknown. */
export function formatVideoClock(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  }
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}
