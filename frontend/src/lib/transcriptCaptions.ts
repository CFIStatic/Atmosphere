/**
 * Build WebVTT cues from Whisper transcript_text / transcriptSegments.
 *
 * Timestamped [m:ss] / [h:mm:ss] lines become seek-synced captions.
 * Unstamped text becomes a single cue covering the clip when possible.
 * Empty input → no track (CC stays unavailable — never a fake empty track).
 */

import type { TranscriptSegment } from './api';

export type CaptionCue = {
  startSec: number;
  endSec: number;
  text: string;
};

function clockToSeconds(raw: string): number | null {
  const parts = raw.split(':').map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  if (parts.length === 1) return parts[0]!;
  return null;
}

function roundTime(seconds: number): number {
  return Math.round(Math.max(0, seconds) * 1000) / 1000;
}

function estimateCueLength(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(12, Math.max(2.2, words * 0.42));
}

/** Parse Whisper-style [m:ss] lines into segments (frontend mirror of backend). */
export function parseTimestampedTranscript(transcript: string | null | undefined): TranscriptSegment[] {
  const src = String(transcript || '').trim();
  if (!src) return [];

  const re = /\[((?:\d+:)+\d+)\]/g;
  const stamps: Array<{ at: number; index: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(src))) {
    const at = clockToSeconds(match[1] ?? '');
    if (at == null || !Number.isFinite(at) || at < 0) continue;
    stamps.push({ at, index: match.index, end: match.index + match[0].length });
  }

  if (!stamps.length) {
    return [{ tSec: null, text: src, speakerLabel: null }];
  }

  const out: TranscriptSegment[] = [];
  for (let i = 0; i < stamps.length; i += 1) {
    const stamp = stamps[i]!;
    const next = stamps[i + 1];
    const body = src
      .slice(stamp.end, next ? next.index : src.length)
      .replace(/^[\s:,.\-–—]+/, '')
      .trim();
    if (!body) continue;
    const speaker = body.match(
      /^(Homeowner|Owner|Home owner|Contractor|Crew|Tech(?:nician)?|Worker|Adjuster|Inspector|Speaker\s*[A-D]|Person\s*[12])\s*[:\-–—]\s*/i,
    );
    if (speaker) {
      out.push({
        tSec: roundTime(stamp.at),
        text: body.slice(speaker[0].length).trim() || body,
        speakerLabel: speaker[1]!.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 24),
      });
    } else {
      out.push({ tSec: roundTime(stamp.at), text: body, speakerLabel: null });
    }
  }
  return out;
}

export function captionCuesFromTranscript(opts: {
  segments?: TranscriptSegment[] | null;
  transcriptText?: string | null;
  durationSeconds?: number | null;
}): CaptionCue[] {
  const rows =
    opts.segments?.length
      ? opts.segments
      : parseTimestampedTranscript(opts.transcriptText);
  if (!rows.length) return [];

  const stamped = rows.filter((row) => row.tSec != null && Number.isFinite(row.tSec) && row.tSec! >= 0);
  const duration =
    opts.durationSeconds != null && Number.isFinite(opts.durationSeconds) && opts.durationSeconds! > 0
      ? opts.durationSeconds!
      : null;

  if (!stamped.length) {
    const text = rows
      .map((row) => {
        const label = row.speakerLabel?.trim();
        return label ? `${label}: ${row.text}` : row.text;
      })
      .join(' ')
      .trim();
    if (!text) return [];
    const end = duration ?? Math.max(8, estimateCueLength(text));
    return [{ startSec: 0, endSec: end, text }];
  }

  const cues: CaptionCue[] = [];
  for (let i = 0; i < stamped.length; i += 1) {
    const row = stamped[i]!;
    const start = roundTime(row.tSec!);
    const next = stamped[i + 1];
    const label = row.speakerLabel?.trim();
    const text = (label ? `${label}: ${row.text}` : row.text).trim();
    if (!text) continue;
    let end =
      next?.tSec != null && Number.isFinite(next.tSec) && next.tSec! > start
        ? roundTime(next.tSec!)
        : roundTime(start + estimateCueLength(text));
    if (duration != null) end = Math.min(end, duration);
    if (end <= start) end = roundTime(start + 1.5);
    cues.push({ startSec: start, endSec: end, text });
  }
  return cues;
}

function formatVttClock(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(totalMs / 3_600_000);
  const m = Math.floor((totalMs % 3_600_000) / 60_000);
  const s = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}

function escapeVttText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r?\n/g, ' ');
}

/** WebVTT document body for a TextTrack, or null when there is nothing to show. */
export function buildWebVtt(cues: CaptionCue[]): string | null {
  if (!cues.length) return null;
  const lines = ['WEBVTT', ''];
  cues.forEach((cue, index) => {
    lines.push(String(index + 1));
    lines.push(`${formatVttClock(cue.startSec)} --> ${formatVttClock(cue.endSec)}`);
    lines.push(escapeVttText(cue.text));
    lines.push('');
  });
  return lines.join('\n');
}

export function webVttFromTranscript(opts: {
  segments?: TranscriptSegment[] | null;
  transcriptText?: string | null;
  durationSeconds?: number | null;
}): string | null {
  return buildWebVtt(captionCuesFromTranscript(opts));
}
