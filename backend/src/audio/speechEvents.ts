/**
 * Seekable speech moments for the Analysis timeline.
 *
 * Whisper already wrote `job_proofs.transcript_text`. Vision already built
 * SCENE / CAMERA / WORK rows. This pass turns a real conversation — agreements,
 * concerns, rooms, scope talk — into SAID rows that interleave by time.
 *
 * Silent walkthroughs, skipped mics, and noise-only transcripts stay empty.
 * A 10-minute Whisper dump stamped [0:00] is not a speech event.
 */

import {
  conversationSentences,
  extractConversationDetails,
  hasConversation,
  roomsMentionedIn,
  type ConversationDetails,
} from './conversationDetails.js';

export const SAID_EVENT_TYPE = 'said' as const;

export type SpeechEvent = {
  atSeconds: number;
  text: string;
  type: typeof SAID_EVENT_TYPE;
};

const MAX_SPEECH_EVENTS = 12;
const MAX_SPEECH_CHARS = 240;
/** A stamped line this short is already one moment — do not offset inside it. */
const STAMPED_LINE_CHARS = 240;

type Segment = {
  at: number | null;
  text: string;
  nextAt: number | null;
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
  return Math.round(Math.max(0, seconds) * 100) / 100;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueLines(values: string[], max = MAX_SPEECH_EVENTS): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const text = value.replace(/\s+/g, ' ').trim().slice(0, MAX_SPEECH_CHARS);
    if (!text || text.length > MAX_SPEECH_CHARS) continue;
    const key = normalize(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

/** Split a filed transcript into stamped chunks plus any unstamped remainder. */
export function transcriptSegments(transcript: string): Segment[] {
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
    return [{ at: null, text: src, nextAt: null }];
  }

  const segments: Segment[] = [];
  for (let i = 0; i < stamps.length; i += 1) {
    const stamp = stamps[i]!;
    const next = stamps[i + 1];
    const body = src
      .slice(stamp.end, next ? next.index : src.length)
      .replace(/^[\s:,.\-–—]+/, '')
      .trim();
    if (!body) continue;
    segments.push({
      at: stamp.at,
      text: body,
      nextAt: next ? next.at : null,
    });
  }
  return segments;
}

function substanceLines(transcript: string, details: ConversationDetails): string[] {
  const roomLines = conversationSentences(transcript).filter(
    (line) => roomsMentionedIn(line).length > 0,
  );
  return uniqueLines([
    ...details.agreements,
    ...details.concerns,
    ...details.details,
    ...roomLines,
  ]);
}

function locateLine(
  line: string,
  segments: Segment[],
): { segment: Segment; index: number; hayLen: number } | null {
  const needle = normalize(line);
  if (!needle) return null;
  const head = needle.slice(0, Math.min(needle.length, 48));
  for (const segment of segments) {
    const hay = normalize(segment.text);
    if (!hay) continue;
    let index = hay.indexOf(needle);
    if (index < 0 && head.length >= 16) index = hay.indexOf(head);
    if (index < 0 && needle.length >= 20 && needle.includes(hay.slice(0, Math.min(hay.length, 48)))) {
      index = 0;
    }
    if (index < 0) continue;
    return { segment, index, hayLen: hay.length };
  }
  return null;
}

function timeForHit(
  hit: { segment: Segment; index: number; hayLen: number },
  durationSeconds: number | null,
): number | null {
  const base = hit.segment.at;
  if (base == null) {
    if (durationSeconds == null || durationSeconds <= 0 || hit.hayLen <= 0) return null;
    return roundTime((hit.index / hit.hayLen) * durationSeconds);
  }

  const span =
    hit.segment.nextAt != null && hit.segment.nextAt > base
      ? hit.segment.nextAt - base
      : durationSeconds != null && durationSeconds > base
        ? durationSeconds - base
        : null;

  if (span && hit.hayLen > 0 && hit.segment.text.length > STAMPED_LINE_CHARS) {
    return roundTime(base + (hit.index / hit.hayLen) * span);
  }
  return roundTime(base);
}

function fallbackTime(
  index: number,
  total: number,
  durationSeconds: number | null,
): number | null {
  if (durationSeconds == null || durationSeconds <= 0 || total <= 0) return null;
  return roundTime(((index + 1) / (total + 1)) * durationSeconds);
}

/**
 * SAID rows for a clip that has a real conversation. Empty when the mic
 * was silent, skipped, or only picked up tool noise.
 */
export function speechEventsFromTranscript(
  transcript: string | null | undefined,
  opts?: { durationSeconds?: number | null; conversation?: ConversationDetails | null },
): SpeechEvent[] {
  const raw = String(transcript || '').trim();
  if (!raw) return [];

  const details = opts?.conversation ?? extractConversationDetails(raw);
  if (!hasConversation(details)) return [];

  const lines = substanceLines(raw, details);
  if (!lines.length) return [];

  const duration = Number(opts?.durationSeconds);
  const durationSeconds = Number.isFinite(duration) && duration > 0 ? duration : null;
  const segments = transcriptSegments(raw);

  const events: SpeechEvent[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i]!;
    const hit = locateLine(text, segments);
    const at = hit
      ? timeForHit(hit, durationSeconds)
      : fallbackTime(i, lines.length, durationSeconds);
    if (at == null || !Number.isFinite(at) || at < 0) continue;
    const key = `${at}|${normalize(text)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push({ atSeconds: at, text, type: SAID_EVENT_TYPE });
    if (events.length >= MAX_SPEECH_EVENTS) break;
  }

  return events.sort((a, b) => a.atSeconds - b.atSeconds || a.text.localeCompare(b.text));
}
