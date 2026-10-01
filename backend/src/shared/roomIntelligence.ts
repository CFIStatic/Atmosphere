/**
 * Room segments for a clip, and the same physical room across a job.
 *
 * Bounds come from the analysis already on the clip (explicit roomSegments
 * when the vision pass emitted them, otherwise room labels on actions and
 * scene events). Findings are exact sentences from those actions and events.
 * Nothing here calls a model or invents a room, a date, or a line of speech.
 */
import { createHash } from 'node:crypto';
import { secondsInChildPrivacyRange, childPrivacyRedactionsFromStored } from '../audio/childPrivacyRedactions.js';
import { privacyRedactionsFromStored, secondsInPrivacyRange, type PrivacyRedactionRange } from '../audio/privacyRedactions.js';
import type { ChildPrivacyRange } from '../audio/childPrivacyRedactions.js';
import { formatAskClock, formatAskDate, parseAskDate } from './askMoments.js';

export type RoomFindingKind = 'damage' | 'characteristic' | 'work';

export type RoomFinding = {
  kind: RoomFindingKind;
  /** Exact substring of an action or event description. */
  text: string;
  atSeconds: number;
  beforeAfter: 'before' | 'after' | null;
};

export type RoomSpeech = {
  text: string;
  atSeconds: number;
  speaker: string | null;
};

export type RoomIdentity = {
  roomType: string;
  qualifier: string | null;
};

export type ClipRoomSegment = {
  sequenceIndex: number;
  roomName: string;
  roomType: string;
  qualifier: string | null;
  roomKey: string;
  startSeconds: number;
  endSeconds: number;
  confidence: number;
  findings: RoomFinding[];
  speech: RoomSpeech[];
};

export type RoomSighting = ClipRoomSegment & {
  proofId: string;
  clipTitle: string;
  workDate: string | null;
};

export type JobRoom = {
  roomKey: string;
  roomName: string;
  roomType: string;
  qualifier: string | null;
  traits: string[];
  firstSeen: string | null;
  lastSeen: string | null;
  datesWorked: string[];
  sightings: RoomSighting[];
};

export type RoomClipInput = {
  proofId: string;
  title?: string | null;
  workDate?: string | null;
  phase?: string | null;
  durationSeconds?: number | null;
  actions?: unknown;
  events?: unknown;
  /** Explicit spans from the vision JSON, when that pass emitted them. */
  roomSegments?: unknown;
  transcript?: string | null;
  transcriptSegments?: unknown;
  privacyRedactions?: unknown;
  childPrivacyRedactions?: unknown;
};

const WORK_ACTIONS = new Set([
  'locate', 'measure', 'mark', 'pick_up', 'carry', 'position', 'align', 'cut', 'drill',
  'fasten', 'apply', 'connect', 'test', 'inspect', 'remove', 'clean', 'protect', 'correct',
]);

const FIXTURE_WORDS = [
  'vanity', 'cabinet', 'tile', 'granite', 'quartz', 'faucet', 'fixture', 'counter', 'countertop',
  'shower', 'tub', 'toilet', 'floor', 'window', 'door', 'trim', 'paint', 'hardwood', 'vinyl',
  'backsplash', 'sink', 'mirror', 'drywall', 'baseboard', 'appliance',
];

const DAMAGE_RE =
  /\b(crack(?:ed|s|ing)?|stain(?:ed|s)?|damag(?:e|ed)|mold|rot(?:ted|ting)?|leak(?:ing|ed|s)?|hole|missing|broken|swollen|peel(?:ing|ed)?|water damage|deteriorat\w*)\b/i;

const WORK_TEXT_RE =
  /\b(install(?:s|ed|ing)?|remov(?:e|es|ed|ing)|repair(?:s|ed|ing)?|replac(?:e|es|ed|ing)|paint(?:s|ed|ing)?|demo(?:lish(?:ed|es)?)?|caulk(?:s|ed|ing)?|hang(?:s|ing|ed)?|mud(?:s|ded|ding)?|prime(?:s|d|ing)?|fasten(?:s|ed|ing)?|set(?:s|ting)?\s+the|tear(?:s|ing)?\s+out)\b/i;

const COMPLETE_RE = /\b(complet(?:e|ed|ion)|finished)\b/i;
const NOT_COMPLETE_RE = /\b(not|n't|never|incomplete|didn't|did not|hasn't|has not)\b/i;

type Span = { start: number; end: number; identity: RoomIdentity; confidence: number };

function clean(value: unknown, max = 400): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function num(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function roomKeyOf(identity: RoomIdentity): string {
  return `${identity.roomType}::${identity.qualifier ?? ''}`;
}

export function roomDisplayName(identity: RoomIdentity): string {
  if (identity.roomType === 'unclear') return 'room unclear';
  if (identity.qualifier === 'powder') return 'powder room';
  if (!identity.qualifier) return identity.roomType;
  if (/^\d+$/.test(identity.qualifier)) return `${identity.roomType} ${identity.qualifier}`;
  return `${identity.qualifier} ${identity.roomType}`;
}

/**
 * A room label from analysis or a question. Unknown or empty text is
 * "room unclear" — never a guessed room.
 */
export function parseRoomLabel(raw: unknown): RoomIdentity {
  const text = clean(raw, 80).toLowerCase();
  if (!text) return { roomType: 'unclear', qualifier: null };
  if (/\broom unclear\b|\bunidentified\b|\bunknown room\b|\bcannot tell\b|\bcan't tell\b/.test(text)) {
    return { roomType: 'unclear', qualifier: null };
  }
  const primary = text.match(/\b(?:primary|master)\s+bath(?:room)?\b/);
  if (primary) return { roomType: 'bathroom', qualifier: 'primary' };
  const qualifiedBath = text.match(/\b(hall|hallway|guest|powder)\s+bath(?:room)?\b/);
  if (qualifiedBath) {
    const word = qualifiedBath[1] === 'hallway' ? 'hall' : qualifiedBath[1]!;
    return { roomType: 'bathroom', qualifier: word };
  }
  if (/\bpowder\s+room\b/.test(text)) return { roomType: 'bathroom', qualifier: 'powder' };
  const numbered = text.match(/\b(?:bathroom|bath)\s*#?\s*(\d+)\b/) || text.match(/\b(\d+)(?:st|nd|rd|th)?\s+(?:bathroom|bath)\b/);
  if (numbered) return { roomType: 'bathroom', qualifier: numbered[1]! };
  if (/\bliving\s+room\b|\bfamily\s+room\b/.test(text)) return { roomType: 'living room', qualifier: null };
  if (/\bdining\s+room\b/.test(text)) return { roomType: 'dining room', qualifier: null };
  if (/\blaundry(?:\s+room)?\b/.test(text)) return { roomType: 'laundry', qualifier: null };
  if (/\b(?:mechanical|utility)\s+room\b/.test(text)) return { roomType: 'utility room', qualifier: null };
  const named = text.match(
    /\b(kitchen|bathroom|bath|bedroom|hallway|hall|office|garage|basement|attic|exterior|closet|pantry|mudroom|foyer)\b/,
  );
  if (named) {
    const word = named[1]!;
    if (word === 'bath') return { roomType: 'bathroom', qualifier: null };
    if (word === 'hall') return { roomType: 'hallway', qualifier: null };
    return { roomType: word, qualifier: null };
  }
  const words = text.split(' ').filter(Boolean);
  if (words.length > 0 && words.length <= 3 && !/\b(camera|enters|moves|shows|video)\b/.test(text)) {
    return { roomType: text, qualifier: null };
  }
  return { roomType: 'unclear', qualifier: null };
}

/** The room a question is asking about, if it names one. */
export function askedRoom(question: string): RoomIdentity | null {
  const text = question.toLowerCase();
  if (/\broom unclear\b/.test(text)) return { roomType: 'unclear', qualifier: null };
  const specific = [
    /\b(?:primary|master)\s+bath(?:room)?\b/,
    /\b(?:hall|hallway|guest|powder)\s+bath(?:room)?\b/,
    /\bpowder\s+room\b/,
    /\b(?:bathroom|bath)\s*#?\s*\d+\b/,
    /\b\d+(?:st|nd|rd|th)?\s+(?:bathroom|bath)\b/,
    /\bliving\s+room\b/,
    /\bdining\s+room\b/,
    /\blaundry(?:\s+room)?\b/,
    /\b(?:mechanical|utility)\s+room\b/,
    /\b(kitchen|bathroom|bedroom|hallway|office|garage|basement|attic|exterior|closet|pantry|mudroom|foyer)\b/,
  ];
  for (const re of specific) {
    const hit = text.match(re);
    if (hit) return parseRoomLabel(hit[0]);
  }
  return null;
}

/**
 * A question Ask should answer from room segments.
 * Yes/no presence questions ("did they go in the bathroom?") and speech
 * questions ("what was said in the office recording") stay on their own paths.
 */
export function isRoomQuestion(question: string): boolean {
  const text = question.trim();
  if (/\b(said|say|mention(?:ed|s)?|transcript|recording|spoke|speech|heard)\b/i.test(text)) return false;
  if (/^(?:did|do|does|was|were|is|are|at any point|has|have)\b/i.test(text)) return false;
  if (/\brooms?\b/i.test(text)) return true;
  if (!askedRoom(text)) return false;
  return /\b(work|done|damage|damaged|condition|crack|stain|mold|leak|weeks?|days?|how (?:many|long)|duration|take to|took|fix(?:ed)?|repair(?:ed)?|install(?:ed)?|complete[d]?|characteristic)\b/i.test(text);
}

function asRecords(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
}

/** Parse a vision `roomSegments` array. Invalid rows are dropped, not guessed. */
export function parseRoomSegmentPayload(raw: unknown): Span[] {
  const spans: Span[] = [];
  for (const row of asRecords(raw)) {
    const start = num(row.startSec ?? row.start_seconds ?? row.startSeconds ?? row.start);
    const end = num(row.endSec ?? row.end_seconds ?? row.endSeconds ?? row.end);
    if (start == null || end == null) continue;
    const identity = parseRoomLabel(row.room ?? row.roomName ?? row.name ?? row.label);
    const confidenceRaw = num(row.confidence);
    const confidence = confidenceRaw == null ? (identity.roomType === 'unclear' ? 0.3 : 0.6) : Math.min(1, Math.max(0, confidenceRaw));
    spans.push({ start, end: Math.max(start, end), identity, confidence });
  }
  return spans.sort((a, b) => a.start - b.start || a.end - b.end);
}

type Beat = { at: number; text: string; action: string | null; room: string | null };

function beatsFrom(input: RoomClipInput): Beat[] {
  const beats: Beat[] = [];
  for (const row of asRecords(input.actions)) {
    const text = clean(row.description ?? row.note ?? row.summary ?? row.text);
    const at = num(row.atSeconds ?? row.at_seconds ?? row.t_seconds ?? row.startSeconds);
    if (!text || at == null) continue;
    beats.push({
      at,
      text,
      action: clean(row.action, 40).toLowerCase() || null,
      room: clean(row.room ?? row.area, 80) || null,
    });
  }
  for (const row of asRecords(input.events)) {
    const text = clean(row.text ?? row.description ?? row.summary ?? row.note);
    const at = num(row.atSeconds ?? row.at_seconds ?? row.t_seconds ?? row.tSec ?? row.startSeconds);
    if (!text || at == null) continue;
    const type = clean(row.type, 40).toLowerCase();
    if (type === 'said' || type === 'speech') continue;
    beats.push({ at, text, action: null, room: type === 'scene' ? text : null });
  }
  return beats.sort((a, b) => a.at - b.at);
}

function observeRooms(beats: Beat[]): Array<{ at: number; identity: RoomIdentity; confidence: number }> {
  const out: Array<{ at: number; identity: RoomIdentity; confidence: number }> = [];
  for (const beat of beats) {
    if (beat.room) {
      const identity = parseRoomLabel(beat.room);
      if (identity.roomType !== 'unclear' || /\broom unclear\b|\bunknown room\b|\bunidentified\b/i.test(beat.room)) {
        out.push({ at: beat.at, identity, confidence: identity.roomType === 'unclear' ? 0.35 : 0.72 });
        continue;
      }
    }
    const fromText = parseRoomLabel(beat.text);
    if (fromText.roomType !== 'unclear' && new RegExp(`\\b${fromText.roomType}\\b`, 'i').test(beat.text)) {
      out.push({ at: beat.at, identity: fromText, confidence: 0.58 });
    }
  }
  return out;
}

function sameRoom(a: RoomIdentity, b: RoomIdentity): boolean {
  return a.roomType === b.roomType && a.qualifier === b.qualifier;
}

function buildSpans(input: RoomClipInput, beats: Beat[]): Span[] {
  const explicit = parseRoomSegmentPayload(input.roomSegments);
  const duration = num(input.durationSeconds);
  const lastBeat = beats.length ? beats[beats.length - 1]!.at : 0;
  const end = Math.max(duration ?? 0, lastBeat, explicit.length ? explicit[explicit.length - 1]!.end : 0);
  if (explicit.length) {
    const spans = explicit.map((span) => ({ ...span, end: Math.max(span.start, Math.min(span.end, end || span.end)) }));
    return spans;
  }
  const observations = observeRooms(beats);
  if (!observations.length) {
    if (!beats.length && duration == null) return [];
    return [{ start: 0, end, identity: { roomType: 'unclear', qualifier: null }, confidence: 0.3 }];
  }
  const spans: Span[] = [];
  const first = observations[0]!;
  if (first.at > 1.5) {
    spans.push({ start: 0, end: first.at, identity: { roomType: 'unclear', qualifier: null }, confidence: 0.3 });
  }
  let current: Span = {
    start: first.at > 1.5 ? first.at : 0,
    end: first.at,
    identity: first.identity,
    confidence: first.confidence,
  };
  for (const obs of observations.slice(1)) {
    if (sameRoom(obs.identity, current.identity)) {
      current.end = obs.at;
      current.confidence = Math.min(0.95, (current.confidence + obs.confidence) / 2 + 0.05);
      continue;
    }
    current.end = Math.max(current.start, obs.at);
    spans.push(current);
    current = { start: obs.at, end: obs.at, identity: obs.identity, confidence: obs.confidence };
  }
  current.end = Math.max(current.end, end);
  spans.push(current);
  return spans;
}

function redacted(at: number, end: number | null, privacy: PrivacyRedactionRange[], child: ChildPrivacyRange[]): boolean {
  const points = [at];
  if (end != null && end > at) points.push((at + end) / 2, Math.max(at, end - 0.05));
  return points.some((t) => secondsInPrivacyRange(t, privacy) || secondsInChildPrivacyRange(t, child));
}

function classifyFinding(beat: Beat, phase: string | null): RoomFinding | null {
  const damage = DAMAGE_RE.test(beat.text);
  const work = (beat.action != null && WORK_ACTIONS.has(beat.action)) || WORK_TEXT_RE.test(beat.text);
  const fixture = FIXTURE_WORDS.some((word) => new RegExp(`\\b${word}\\b`, 'i').test(beat.text));
  if (!damage && !work && !fixture) return null;
  const kind: RoomFindingKind = damage ? 'damage' : work ? 'work' : 'characteristic';
  let beforeAfter: 'before' | 'after' | null = null;
  if (kind === 'work') {
    if (phase === 'before' || phase === 'after') beforeAfter = phase;
    if (/\bbefore\b/i.test(beat.text)) beforeAfter = 'before';
    if (/\bafter\b/i.test(beat.text) && !/\bbefore\b/i.test(beat.text)) beforeAfter = 'after';
  }
  return { kind, text: beat.text, atSeconds: beat.at, beforeAfter };
}

function diarizedSpeaker(raw: unknown): string | null {
  const text = clean(raw, 40);
  const match = /^(?:speaker\s*(\d+)|SPEAKER_(\d+))$/i.exec(text);
  if (!match) return null;
  const n = Number(match[1] ?? match[2]);
  if (!Number.isFinite(n)) return null;
  const label = /SPEAKER_/i.test(text) ? n + 1 : n;
  return `Speaker ${label}`;
}

function speechRows(input: RoomClipInput): Array<RoomSpeech & { end: number | null }> {
  const fromSegments = asRecords(input.transcriptSegments)
    .map((row) => ({
      text: clean(row.text, 500),
      at: num(row.start ?? row.startSeconds ?? row.tSec ?? row.atSeconds),
      end: num(row.end ?? row.endSeconds),
      speaker: diarizedSpeaker(row.speaker ?? row.speakerLabel),
    }))
    .filter((row) => row.text && row.at != null)
    .map((row) => ({ text: row.text, atSeconds: row.at!, speaker: row.speaker, end: row.end }));
  if (fromSegments.length) return fromSegments;
  const rows: Array<RoomSpeech & { end: number | null }> = [];
  for (const line of String(input.transcript ?? '').split('\n')) {
    const match = line.match(/^\[(\d+):(\d{2})(?::(\d{2}))?\]\s*(.*)$/);
    if (!match) continue;
    const clock = match[3]
      ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
      : Number(match[1]) * 60 + Number(match[2]);
    const body = clean(match[4], 500);
    if (!body) continue;
    rows.push({ text: body, atSeconds: clock, speaker: null, end: null });
  }
  return rows;
}

function inSpan(at: number, span: Span, last: boolean): boolean {
  if (at < span.start - 0.001) return false;
  if (last) return at <= span.end + 0.001;
  return at < span.end - 0.001;
}

/** Split one clip into room segments and attach only evidenced findings and speech. */
export function segmentClipRooms(input: RoomClipInput): ClipRoomSegment[] {
  const beats = beatsFrom(input);
  const spans = buildSpans(input, beats);
  const privacy = privacyRedactionsFromStored(input.privacyRedactions);
  const child = childPrivacyRedactionsFromStored(input.childPrivacyRedactions);
  const phase = input.phase === 'before' || input.phase === 'after' ? input.phase : null;
  const speech = speechRows(input);
  const seenFinding = new Set<string>();
  return spans.map((span, index) => {
    const last = index === spans.length - 1;
    const findings: RoomFinding[] = [];
    for (const beat of beats) {
      if (!inSpan(beat.at, span, last)) continue;
      if (redacted(beat.at, null, privacy, child)) continue;
      const finding = classifyFinding(beat, phase);
      if (!finding) continue;
      const key = `${finding.kind}|${finding.atSeconds}|${finding.text}`;
      if (seenFinding.has(key)) continue;
      seenFinding.add(key);
      findings.push(finding);
      if (findings.length >= 12) break;
    }
    const lines: RoomSpeech[] = [];
    for (const line of speech) {
      if (!inSpan(line.atSeconds, span, last)) continue;
      if (redacted(line.atSeconds, line.end, privacy, child)) continue;
      lines.push({ text: line.text, atSeconds: line.atSeconds, speaker: line.speaker });
      if (lines.length >= 8) break;
    }
    const identity = span.identity;
    return {
      sequenceIndex: index,
      roomName: roomDisplayName(identity),
      roomType: identity.roomType,
      qualifier: identity.qualifier,
      roomKey: roomKeyOf(identity),
      startSeconds: Math.round(span.start * 100) / 100,
      endSeconds: Math.round(Math.max(span.start, span.end) * 100) / 100,
      confidence: Math.round(span.confidence * 100) / 100,
      findings,
      speech: lines,
    };
  });
}

function traitsOf(sighting: RoomSighting): string[] {
  const found = new Set<string>();
  for (const finding of sighting.findings) {
    if (finding.kind === 'damage') continue;
    const text = finding.text.toLowerCase();
    for (const word of FIXTURE_WORDS) {
      if (new RegExp(`\\b${word}\\b`).test(text)) found.add(word);
    }
  }
  return [...found];
}

function traitsConflict(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false;
  return a.every((trait) => !b.includes(trait));
}

function ymd(value: string | null | undefined): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value ?? '').trim());
  return match ? match[1]! : null;
}

/** Resolve clip segments to job-level rooms. The same room on later clips accumulates. */
export function matchRoomsAcrossClips(clips: RoomClipInput[]): JobRoom[] {
  const groups = new Map<string, { identity: RoomIdentity; sightings: RoomSighting[]; traits: Set<string> }>();
  for (const clip of clips) {
    const segments = segmentClipRooms(clip);
    for (const segment of segments) {
      const sighting: RoomSighting = {
        ...segment,
        proofId: clip.proofId,
        clipTitle: clean(clip.title, 160) || 'Clip',
        workDate: ymd(clip.workDate),
      };
      const key = segment.roomKey;
      const group = groups.get(key) ?? {
        identity: { roomType: segment.roomType, qualifier: segment.qualifier },
        sightings: [],
        traits: new Set<string>(),
      };
      group.sightings.push(sighting);
      for (const trait of traitsOf(sighting)) group.traits.add(trait);
      groups.set(key, group);
    }
  }

  for (const [key, group] of [...groups.entries()]) {
    if (group.identity.qualifier || group.identity.roomType === 'unclear') continue;
    const specific = [...groups.entries()].filter(
      ([otherKey, other]) =>
        otherKey !== key &&
        other.identity.roomType === group.identity.roomType &&
        other.identity.qualifier &&
        other.identity.roomType !== 'unclear',
    );
    if (specific.length !== 1) continue;
    const target = specific[0]![1];
    if (traitsConflict([...group.traits], [...target.traits])) continue;
    target.sightings.push(...group.sightings);
    for (const trait of group.traits) target.traits.add(trait);
    groups.delete(key);
  }

  const rooms: JobRoom[] = [];
  for (const group of groups.values()) {
    const dates = [...new Set(group.sightings.map((s) => s.workDate).filter((d): d is string => Boolean(d)))].sort();
    const identity = group.identity;
    rooms.push({
      roomKey: roomKeyOf(identity),
      roomName: roomDisplayName(identity),
      roomType: identity.roomType,
      qualifier: identity.qualifier,
      traits: [...group.traits],
      firstSeen: dates[0] ?? null,
      lastSeen: dates[dates.length - 1] ?? null,
      datesWorked: dates,
      sightings: group.sightings.sort((a, b) => (a.workDate ?? '').localeCompare(b.workDate ?? '') || a.startSeconds - b.startSeconds),
    });
  }
  return rooms.sort((a, b) => a.roomName.localeCompare(b.roomName));
}

function dateParts(iso: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function dayNumber(iso: string): number | null {
  const parts = dateParts(iso);
  if (!parts) return null;
  return Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000;
}

export function formatWorkDate(iso: string | null): string | null {
  const parts = iso ? dateParts(iso) : null;
  if (!parts) return null;
  return formatAskDate(parts);
}

function weeksLabel(first: string, last: string): string | null {
  const a = dayNumber(first);
  const b = dayNumber(last);
  if (a == null || b == null) return null;
  const days = Math.abs(b - a);
  if (days === 0) return 'the same day';
  if (days < 7) return days === 1 ? 'about 1 day' : `about ${days} days`;
  const weeks = Math.max(1, Math.round(days / 7));
  return weeks === 1 ? 'about 1 week' : `about ${weeks} weeks`;
}

export type RoomDuration = {
  first: RoomSighting | null;
  last: RoomSighting | null;
  label: string | null;
  completionEstablished: boolean;
  prose: string;
};

function workSightings(room: JobRoom): RoomSighting[] {
  return room.sightings.filter((sighting) => sighting.findings.some((finding) => finding.kind === 'work') && sighting.workDate);
}

export function roomWorkDuration(room: JobRoom): RoomDuration {
  const worked = workSightings(room).slice().sort((a, b) => (a.workDate ?? '').localeCompare(b.workDate ?? ''));
  const name = room.roomName;
  if (!worked.length) {
    return {
      first: null,
      last: null,
      label: null,
      completionEstablished: false,
      prose: `The ${name} is on this file, but no dated work in that room is recorded, so a duration is not measured. The file does not establish completion.`,
    };
  }
  const first = worked[0]!;
  const last = worked[worked.length - 1]!;
  const completion = room.sightings.some((sighting) =>
    sighting.findings.some((finding) => finding.kind === 'work' && COMPLETE_RE.test(finding.text) && !NOT_COMPLETE_RE.test(finding.text)),
  );
  if (first.proofId === last.proofId) {
    const when = formatWorkDate(first.workDate);
    return {
      first,
      last,
      label: null,
      completionEstablished: completion,
      prose: `Only one ${name} work clip is on file${when ? ` (${when}, ${first.clipTitle})` : ''}, so a duration in weeks is not measured. ${
        completion ? 'That clip describes the work as complete.' : 'The file does not establish completion.'
      }`,
    };
  }
  const label = weeksLabel(first.workDate!, last.workDate!);
  const prose = [
    `The ${name} work on file runs from the first ${name} work clip on ${formatWorkDate(first.workDate)} (${first.clipTitle}) to the last on ${formatWorkDate(last.workDate)} (${last.clipTitle})${label ? `, ${label}` : ''}.`,
    completion ? 'A clip on file describes that work as complete.' : 'The file does not establish completion.',
  ].join(' ');
  return { first, last, label, completionEstablished: completion, prose };
}

function clipDateMatches(workDate: string | null, asked: { month: number; day: number; year: number | null }): boolean {
  const parts = workDate ? dateParts(workDate) : null;
  if (!parts) return false;
  if (parts.month !== asked.month || parts.day !== asked.day) return false;
  if (asked.year != null && parts.year !== asked.year) return false;
  return true;
}

function cite(sighting: RoomSighting, at: number): string {
  return `${sighting.clipTitle}, ${formatAskClock(at)}`;
}

function findingLine(sighting: RoomSighting, finding: RoomFinding): string {
  const when = formatWorkDate(sighting.workDate);
  const dated = when ? `${when}, ` : '';
  return `${dated}${finding.text} (${cite(sighting, finding.atSeconds)})`;
}

function pickRoom(question: string, rooms: JobRoom[]): { room: JobRoom | null; ambiguous: JobRoom[] } {
  const asked = askedRoom(question);
  if (!asked) return { room: null, ambiguous: [] };
  const named = rooms.filter((room) => room.roomType !== 'unclear');
  const exact = named.filter((room) => room.roomType === asked.roomType && room.qualifier === asked.qualifier);
  if (asked.qualifier) return { room: exact[0] ?? null, ambiguous: [] };
  const ofType = named.filter((room) => room.roomType === asked.roomType);
  if (ofType.length === 1) return { room: ofType[0]!, ambiguous: [] };
  if (ofType.length > 1) return { room: null, ambiguous: ofType };
  return { room: null, ambiguous: [] };
}

function wantsDuration(question: string): boolean {
  return /\b(how (?:many|long)|weeks?|days?|duration|take to|took)\b/i.test(question);
}

function wantsDamage(question: string): boolean {
  return /\b(damage|damaged|condition|crack|stain|mold|leak|what'?s wrong|what is wrong)\b/i.test(question);
}

function wantsWork(question: string): boolean {
  return /\b(work|done|did|complete|completed|fix|fixed|repair|install)\b/i.test(question);
}

/**
 * Deterministic room answer. Null when the question is not about a room.
 * Every finding keeps the clip name and seek time. Completion is stated only
 * when a work note on file says the work is complete.
 */
export function answerRoomQuestion(question: string, clips: RoomClipInput[]): string | null {
  if (!isRoomQuestion(question)) return null;
  const rooms = matchRoomsAcrossClips(clips);
  const named = rooms.filter((room) => room.roomType !== 'unclear');
  const asked = askedRoom(question);
  if (!asked) {
    if (!named.length) return 'No named room is on file. Where the clip does not show a room, it is marked room unclear.';
    const list = named.map((room) => room.roomName).join(', ');
    return `The rooms on this file are ${list}.`;
  }
  const picked = pickRoom(question, rooms);
  if (picked.ambiguous.length > 1) {
    const list = picked.ambiguous.map((room) => room.roomName).join(' and ');
    return `This file has ${list}. The question does not say which one, so one answer would mix different rooms.`;
  }
  const display = roomDisplayName(asked);
  if (!picked.room) {
    const known = named.length ? ` Rooms on file: ${named.map((room) => room.roomName).join(', ')}.` : '';
    const article = /^[aeiou]/i.test(display) ? 'An' : 'A';
    return `${article} ${display} is not on file.${known}`;
  }
  const room = picked.room;
  const askedDate = parseAskDate(question);
  let sightings = room.sightings;
  if (askedDate) {
    sightings = sightings.filter((sighting) => clipDateMatches(sighting.workDate, askedDate));
    if (!sightings.length) {
      const when = formatAskDate(askedDate);
      return `No ${room.roomName} clip on ${when} is on file.`;
    }
  }
  if (wantsDuration(question) && !askedDate) {
    return roomWorkDuration(room).prose;
  }

  const kind: RoomFindingKind | null = wantsDamage(question) && !wantsWork(question) ? 'damage' : wantsWork(question) ? 'work' : null;
  const findings = sightings.flatMap((sighting) =>
    sighting.findings.filter((finding) => (kind ? finding.kind === kind : true)).map((finding) => findingLine(sighting, finding)),
  );
  const when = askedDate ? formatAskDate(askedDate) : null;
  if (kind === 'damage') {
    if (!findings.length) return `No damage in the ${room.roomName} is recorded on this file${when ? ` for ${when}` : ''}.`;
    return `Damage in the ${room.roomName}${when ? ` on ${when}` : ''}: ${findings.join(' ')}`;
  }
  if (kind === 'work') {
    if (!findings.length) return `No work in the ${room.roomName} is recorded on this file${when ? ` for ${when}` : ''}.`;
    const lead = when
      ? `On ${when}, work in the ${room.roomName} on file:`
      : `Work in the ${room.roomName} on file:`;
    return `${lead} ${findings.join(' ')}`;
  }
  if (!findings.length) {
    return `The ${room.roomName} is on this file${when ? ` on ${when}` : ''}, and no damage, fixture, or work note is recorded for it.`;
  }
  return `In the ${room.roomName}${when ? ` on ${when}` : ''}: ${findings.join(' ')}`;
}

/**
 * Stable hash of the analysis a room pass reads. Pass the bounds that will be
 * stored (start, end, room, confidence). Backfill skips a matching hash, and
 * writing those bounds back onto the clip does not change the next hash.
 */
export function roomAnalysisFingerprint(input: RoomClipInput): string {
  const payload = JSON.stringify({
    actions: input.actions ?? null,
    events: input.events ?? null,
    roomSegments: input.roomSegments ?? null,
    transcript: input.transcript ?? null,
    segments: input.transcriptSegments ?? null,
    privacy: input.privacyRedactions ?? null,
    child: input.childPrivacyRedactions ?? null,
    duration: input.durationSeconds ?? null,
    phase: input.phase ?? null,
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 32);
}

/** Catalog clips (job Ask or clip Ask) into the room segmenter. */
export function roomClipsFromLookupClips(
  clips: Array<{
    proofId: string;
    title?: string | null;
    workDate?: string | null;
    durationSeconds?: number | null;
    phase?: string | null;
    transcript?: string | null;
    segments?: unknown;
    findings?: unknown;
    privacyRedactions?: unknown;
    childPrivacyRedactions?: unknown;
  }>,
): RoomClipInput[] {
  return clips.map((clip) => {
    const findings =
      clip.findings && typeof clip.findings === 'object' ? (clip.findings as Record<string, unknown>) : {};
    return {
      proofId: clip.proofId,
      title: clip.title,
      workDate: clip.workDate,
      phase: clip.phase,
      durationSeconds: clip.durationSeconds,
      actions: findings.actions,
      events: findings.events,
      roomSegments: findings.roomSegments,
      transcript: clip.transcript,
      transcriptSegments: clip.segments,
      privacyRedactions: clip.privacyRedactions ?? findings.privacyRedactions,
      childPrivacyRedactions: clip.childPrivacyRedactions ?? findings.childPrivacyRedactions,
    };
  });
}

export function shouldRewriteRooms(
  existing: Array<{ fingerprint?: string | null; userCorrected?: boolean }>,
  nextFingerprint: string,
): boolean {
  if (existing.some((row) => row.userCorrected)) return false;
  if (!existing.length) return true;
  return existing.some((row) => row.fingerprint !== nextFingerprint);
}
