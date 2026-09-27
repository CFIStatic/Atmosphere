/**
 * Build WebVTT cues from Whisper transcript_text / transcriptSegments.
 *
 * Timestamped [m:ss] / [h:mm:ss] lines become seek-synced captions.
 * Unstamped text becomes cues covering the clip when possible.
 * A long turn is split into about two lines, timed across that turn.
 * Empty input → no cues (CC stays unavailable — never a fake empty track).
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

/** About two lines in the player caption box. Longer Whisper turns are split. */
export const CAPTION_MAX_CHARS = 68;
/** YouTube packs a caption line to about this many characters. */
export const CAPTION_LINE_CHARS = 32;
/** Keep a finished line up briefly across a pause, then clear it. */
const CAPTION_HOLD_SEC = 0.8;

export type CaptionWord = {
  text: string;
  startSec: number;
  endSec: number;
};

function splitCaptionText(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= CAPTION_MAX_CHARS) return [clean];
  const words = clean.split(' ');
  const parts: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && next.length > CAPTION_MAX_CHARS) {
      parts.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) parts.push(line);
  return parts;
}

/** Spread a coarse segment across its own window, weighted by how much text each chunk holds. */
function spreadCue(cue: CaptionCue): CaptionCue[] {
  const parts = splitCaptionText(cue.text);
  if (parts.length <= 1) return parts.length ? [{ ...cue, text: parts[0]! }] : [];
  const span = Math.max(0.001, cue.endSec - cue.startSec);
  const weights = parts.map((part) => Math.max(1, part.length));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = cue.startSec;
  return parts.map((text, index) => {
    const width = (weights[index]! / total) * span;
    const startSec = roundTime(cursor);
    const endSec = index === parts.length - 1 ? roundTime(cue.endSec) : roundTime(cursor + width);
    cursor += width;
    return {
      startSec,
      endSec: endSec > startSec ? endSec : roundTime(startSec + Math.min(1.2, span)),
      text,
    };
  });
}

function cleanCaptionWord(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Pack timed words into lines the way a caption file breaks a phrase. */
export function packCaptionLines(words: CaptionWord[], maxChars = CAPTION_LINE_CHARS): CaptionWord[][] {
  const lines: CaptionWord[][] = [];
  let line: CaptionWord[] = [];
  let len = 0;
  for (const word of words) {
    const text = cleanCaptionWord(word.text);
    if (!text) continue;
    const add = len === 0 ? text.length : text.length + 1;
    if (line.length && len + add > maxChars) {
      lines.push(line);
      line = [{ ...word, text }];
      len = text.length;
    } else {
      line.push({ ...word, text });
      len += add;
    }
  }
  if (line.length) lines.push(line);
  return lines;
}

/**
 * Words spoken so far, at most two lines. A new line rolls the oldest line off.
 * Words whose start is still ahead stay hidden.
 */
export function rollingCaptionAt(
  words: CaptionWord[] | null | undefined,
  timeSec: number,
  maxChars = CAPTION_LINE_CHARS,
): string[] | null {
  if (!words?.length || !Number.isFinite(timeSec)) return null;
  const lines = packCaptionLines(words, maxChars);
  if (!lines.length) return null;
  let activeLine = -1;
  let activeIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const row = lines[i]!;
    for (let j = 0; j < row.length; j += 1) {
      if (row[j]!.startSec <= timeSec) {
        activeLine = i;
        activeIndex = j;
      }
    }
  }
  if (activeLine < 0) return null;
  const spoken = lines[activeLine]![activeIndex]!;
  const flat = lines.flat();
  const spokenAt = flat.indexOf(spoken);
  const next = spokenAt >= 0 ? flat[spokenAt + 1] : undefined;
  if (timeSec > spoken.endSec + CAPTION_HOLD_SEC && (!next || timeSec < next.startSec)) return null;

  const visible: string[] = [];
  for (let i = Math.max(0, activeLine - 1); i <= activeLine; i += 1) {
    const row =
      i === activeLine ? lines[i]!.filter((word) => word.startSec <= timeSec) : lines[i]!;
    const text = row.map((word) => word.text).join(' ').trim();
    if (text) visible.push(text);
  }
  return visible.length ? visible.slice(0, 2) : null;
}

/** Untimed cue text, at most two lines, each with its own background. */
export function wrapCaptionLines(text: string, maxChars = CAPTION_LINE_CHARS): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const width = Math.max(maxChars, Math.ceil(clean.length / 2));
  const words = clean.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && next.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= 2) return lines;
  return [lines[0]!, lines.slice(1).join(' ')];
}

/** The cue on screen at this playhead, or null between lines. */
export function activeCaptionAt(cues: CaptionCue[], timeSec: number): CaptionCue | null {
  if (!Number.isFinite(timeSec) || !cues.length) return null;
  for (const cue of cues) {
    if (timeSec >= cue.startSec && timeSec < cue.endSec) return cue;
  }
  const last = cues[cues.length - 1];
  if (last && timeSec >= last.startSec && timeSec <= last.endSec + 0.05) return last;
  return null;
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
    return spreadCue({ startSec: 0, endSec: end, text });
  }

  const cues: CaptionCue[] = [];
  for (let i = 0; i < stamped.length; i += 1) {
    const row = stamped[i]!;
    const start = roundTime(row.tSec!);
    const next = stamped[i + 1];
    const label = row.speakerLabel?.trim();
    const text = (label ? `${label}: ${row.text}` : row.text).trim();
    if (!text) continue;
    // A lone [0:00] blob is the whole clip. Any later last turn ends with the speech.
    const coverWholeClip = stamped.length === 1 && start === 0 && text.length > CAPTION_MAX_CHARS;
    let end =
      next?.tSec != null && Number.isFinite(next.tSec) && next.tSec! > start
        ? roundTime(next.tSec!)
        : duration != null && duration > start && coverWholeClip
          ? duration
          : roundTime(start + estimateCueLength(text));
    if (duration != null) end = Math.min(end, duration);
    if (end <= start) end = roundTime(start + 1.5);
    cues.push({ startSec: start, endSec: end, text });
  }
  return cues.flatMap(spreadCue);
}

/** Word-timed rolling lines, or the proportional cue when the clip has no word clock. */
export function captionLinesAt(opts: {
  words?: CaptionWord[] | null;
  segments?: TranscriptSegment[] | null;
  transcriptText?: string | null;
  durationSeconds?: number | null;
  timeSec: number;
}): string[] | null {
  if (opts.words?.length) return rollingCaptionAt(opts.words, opts.timeSec);
  const cue = activeCaptionAt(captionCuesFromTranscript(opts), opts.timeSec);
  if (!cue) return null;
  const lines = wrapCaptionLines(cue.text);
  return lines.length ? lines : null;
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
