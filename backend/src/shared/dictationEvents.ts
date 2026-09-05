/**
 * Event-boundary timestamps for clip analysis.
 *
 * The office Analysis tab lists what is happening at specific moments.
 * Those moments are event-driven (scene change, new activity, speech shift,
 * camera move, work step start/stop) — never a fixed cadence.
 *
 * Persistence shape matches the existing `job_proofs.narration.entries`
 * rows the verifier already renders as `dictationEntries`.
 */

export const MAX_DICTATION_EVENTS = 48;

export const DICTATION_EVENT_TYPES = [
  'scene',
  'activity',
  'speech',
  'camera',
  'work',
  'other',
] as const;

export type DictationEventType = (typeof DICTATION_EVENT_TYPES)[number];

export interface DictationEvent {
  atSeconds: number;
  text: string;
  type?: string | null;
}

const KNOWN_TYPE = new Set<string>(DICTATION_EVENT_TYPES);

function clampSeconds(raw: unknown, frames?: number[], durationSeconds?: number): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  let seconds = Number.isFinite(n) && n >= 0 ? n : 0;
  if (Number.isFinite(durationSeconds) && (durationSeconds as number) > 0) {
    seconds = Math.min(seconds, durationSeconds as number);
  }
  if (!frames?.length) return Math.round(seconds * 100) / 100;
  let best = frames[0]!;
  let bestDelta = Math.abs(best - seconds);
  for (const at of frames) {
    const delta = Math.abs(at - seconds);
    if (delta < bestDelta) {
      best = at;
      bestDelta = delta;
    }
  }
  return best;
}

function cleanText(value: unknown, max = 400): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ').slice(0, max);
  return trimmed || null;
}

function cleanType(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim().toLowerCase().replace(/[^a-z_]/g, '');
  if (!t) return null;
  return KNOWN_TYPE.has(t) ? t : 'other';
}

function clockToSeconds(raw: string): number | null {
  const parts = raw.split(':').map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  if (parts.length === 1) return parts[0]!;
  return null;
}

/**
 * Split a prose dictation that already carries times ("At 12 seconds…",
 * "[0:08] …") into event rows. A single "At 0 seconds, …" paragraph stays
 * one row — this does not invent a cadence.
 */
export function parseTimestampedNarration(text: string): DictationEvent[] {
  const src = String(text || '').trim();
  if (!src) return [];

  const re = /\bAt\s+(\d+(?:\.\d+)?)(?:\s+seconds?)?\b[:,]?|\[((?:\d+:)+\d+)\]/gi;
  const stamps: Array<{ at: number; end: number; index: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(src))) {
    const at = match[1] != null ? Number(match[1]) : clockToSeconds(match[2] ?? '');
    if (at == null || !Number.isFinite(at) || at < 0) continue;
    stamps.push({ at, index: match.index, end: match.index + match[0].length });
  }
  if (!stamps.length) return [];

  const events: DictationEvent[] = [];
  for (let i = 0; i < stamps.length; i += 1) {
    const stamp = stamps[i]!;
    const next = stamps[i + 1];
    const body = src
      .slice(stamp.end, next ? next.index : src.length)
      .replace(/^[:,.\s-]+/, '')
      .trim();
    const cleaned = cleanText(body);
    if (!cleaned) continue;
    events.push({ atSeconds: Math.round(stamp.at * 100) / 100, text: cleaned, type: 'scene' });
  }
  return dedupeEvents(events);
}

function hasTime(raw: Record<string, unknown>): boolean {
  return (
    raw.atSeconds != null ||
    raw.at_seconds != null ||
    raw.t_seconds != null ||
    raw.tSeconds != null ||
    raw.startSeconds != null ||
    raw.at != null
  );
}

function asEvent(
  raw: Record<string, unknown>,
  opts?: { frames?: number[]; durationSeconds?: number },
): DictationEvent | null {
  const text = cleanText(
    raw.text ?? raw.note ?? raw.summary ?? raw.description ?? raw.label,
  );
  if (!text || !hasTime(raw)) return null;
  const at = clampSeconds(
    raw.atSeconds ?? raw.at_seconds ?? raw.t_seconds ?? raw.tSeconds ?? raw.startSeconds ?? raw.at,
    opts?.frames,
    opts?.durationSeconds,
  );
  return { atSeconds: at, text, type: cleanType(raw.type ?? raw.kind) };
}

/** Parse a model `events` / `entries` array. Unknown shapes are dropped. */
export function parseDictationEvents(
  raw: unknown,
  opts?: { frames?: number[]; durationSeconds?: number },
): DictationEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: DictationEvent[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const parsed = asEvent(item as Record<string, unknown>, opts);
    if (!parsed) continue;
    out.push(parsed);
    if (out.length >= MAX_DICTATION_EVENTS) break;
  }
  return dedupeEvents(out);
}

export function eventsFromActions(
  actions: Array<{ atSeconds?: number; description?: string; action?: string; room?: string | null }>,
): DictationEvent[] {
  const out: DictationEvent[] = [];
  for (const action of actions) {
    const text = cleanText(action.description);
    if (!text) continue;
    const verb = typeof action.action === 'string' ? action.action.toLowerCase() : '';
    const type = verb === 'watch' || verb === 'talk' ? (verb === 'talk' ? 'speech' : 'scene') : 'work';
    out.push({
      atSeconds: Number.isFinite(action.atSeconds) ? Number(action.atSeconds) : 0,
      text,
      type,
    });
    if (out.length >= MAX_DICTATION_EVENTS) break;
  }
  return dedupeEvents(out);
}

function dedupeEvents(events: DictationEvent[]): DictationEvent[] {
  const seen = new Set<string>();
  const out: DictationEvent[] = [];
  for (const event of events) {
    const key = `${event.atSeconds}|${event.text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
  }
  return out.sort((a, b) => a.atSeconds - b.atSeconds);
}

/**
 * Stored `narration.entries` plus a prose fallback for older rows that only
 * have a timestamped `narration_text` blob.
 */
export function resolveDictationEntries(input: {
  stored?: unknown;
  narrationText?: string | null;
  actions?: Array<{ atSeconds?: number; description?: string; action?: string }>;
  frames?: number[];
  durationSeconds?: number;
}): DictationEvent[] {
  const stored = parseDictationEvents(input.stored, {
    frames: input.frames,
    durationSeconds: input.durationSeconds,
  });
  if (stored.length) return stored;
  const fromText = parseTimestampedNarration(input.narrationText ?? '');
  if (fromText.length) return fromText;
  return eventsFromActions(input.actions ?? []);
}

export function narrationEntriesFromEvents(events: DictationEvent[]): Array<{
  atSeconds: number;
  text: string;
  type: string | null;
}> {
  return events.map((event) => ({
    atSeconds: event.atSeconds,
    text: event.text,
    type: event.type ?? null,
  }));
}
