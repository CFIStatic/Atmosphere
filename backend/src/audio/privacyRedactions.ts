/**
 * Private-moment redaction for Field Capture / job videos.
 *
 * Detect privacy intervals (bathroom/toilet/shower, undressing/nudity-adjacent,
 * clearly intimate spaces) during analysis, persist under
 * `ai_findings.privacyRedactions`, and enforce blur+mute in players.
 *
 * Prefer high precision with lean toward over-redacting private spaces rather
 * than leaking them. Never invent rooms; mark confidence. Phase 1: stored
 * ranges + client enforcement. Phase 2: server-side re-encode (see docs).
 */

export const PRIVACY_REDACTIONS_VERSION = 1;
export const PRIVACY_REDACTED_LABEL = '[privacy redacted]';

export type PrivacyRedactionSource = 'vision' | 'heuristic' | 'merged' | 'manual';

export type PrivacyRedactionRange = {
  startSec: number;
  endSec: number;
  reason: string;
  confidence: number;
  source: PrivacyRedactionSource;
};

/** Persisted under `ai_findings.privacyRedactions`. */
export type StoredPrivacyRedactions = {
  version: number;
  ranges: PrivacyRedactionRange[];
  model?: string | null;
};

const PRIVATE_SPACE_RE =
  /\b(bathroom|restroom|toilet|lavatory|shower|bathtub|bath\s*tub|locker\s*room|changing\s*room|dressing\s*room)\b/i;
const INTIMATE_RE =
  /\b(undress(ing|ed)?|disrob(e|ing)|naked|nude|nudity|lingerie|underwear|bra\b|panties|genital|intimate|in\s+the\s+shower|on\s+the\s+toilet)\b/i;

function roundTime(seconds: number): number {
  return Math.round(Math.max(0, seconds) * 100) / 100;
}

function clampConfidence(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, Math.round(n * 100) / 100));
}

function normalizeSource(raw: unknown): PrivacyRedactionSource {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  if (s === 'vision' || s === 'llm' || s === 'model') return 'vision';
  if (s === 'heuristic' || s === 'deterministic') return 'heuristic';
  if (s === 'manual' || s === 'admin') return 'manual';
  if (s === 'merged') return 'merged';
  return 'vision';
}

export function isPrivateMomentText(text: string | null | undefined): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  return PRIVATE_SPACE_RE.test(t) || INTIMATE_RE.test(t);
}

export function reasonFromText(text: string): string {
  const t = text.trim();
  if (INTIMATE_RE.test(t) && PRIVATE_SPACE_RE.test(t)) {
    return 'private space with undressing/nudity-adjacent content';
  }
  if (INTIMATE_RE.test(t)) return 'undressing/nudity-adjacent moment';
  if (/shower/i.test(t)) return 'shower / bathing area';
  if (/toilet|restroom|bathroom|lavatory/i.test(t)) return 'bathroom / toilet area';
  if (/locker|changing|dressing/i.test(t)) return 'changing / locker room';
  return 'private / intimate space';
}

export function secondsInPrivacyRange(
  tSec: number,
  ranges: PrivacyRedactionRange[] | null | undefined,
): PrivacyRedactionRange | null {
  if (!Number.isFinite(tSec) || !ranges?.length) return null;
  for (const r of ranges) {
    if (tSec >= r.startSec && tSec < r.endSec) return r;
    // Inclusive end for paused/seek-on-boundary cases.
    if (Math.abs(tSec - r.endSec) < 0.05) return r;
  }
  return null;
}

export function mergePrivacyRanges(ranges: PrivacyRedactionRange[]): PrivacyRedactionRange[] {
  if (!ranges.length) return [];
  const sorted = [...ranges]
    .filter((r) => Number.isFinite(r.startSec) && Number.isFinite(r.endSec) && r.endSec > r.startSec)
    .map((r) => ({
      ...r,
      startSec: roundTime(r.startSec),
      endSec: roundTime(r.endSec),
      confidence: clampConfidence(r.confidence),
      reason: String(r.reason || 'private moment').slice(0, 200),
      source: normalizeSource(r.source),
    }))
    .sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);

  const out: PrivacyRedactionRange[] = [];
  for (const next of sorted) {
    const prev = out[out.length - 1];
    if (!prev || next.startSec > prev.endSec + 1.5) {
      out.push({ ...next });
      continue;
    }
    prev.endSec = Math.max(prev.endSec, next.endSec);
    prev.startSec = Math.min(prev.startSec, next.startSec);
    prev.confidence = Math.max(prev.confidence, next.confidence);
    if (prev.source !== next.source) prev.source = 'merged';
    if (next.reason && next.reason.length > prev.reason.length) prev.reason = next.reason;
  }
  return out.slice(0, 64);
}

function parseOneRange(raw: unknown): PrivacyRedactionRange | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const start = Number(
    row.startSec ?? row.start_sec ?? row.startSeconds ?? row.t_start ?? row.fromSec ?? row.start,
  );
  const end = Number(
    row.endSec ?? row.end_sec ?? row.endSeconds ?? row.t_end ?? row.toSec ?? row.end,
  );
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  // Cap absurd spans (analysis stills are sparse; a 24h range is not useful).
  if (end - start > 3600) return null;
  const reason = String(row.reason ?? row.label ?? row.description ?? 'private moment')
    .trim()
    .slice(0, 200);
  if (!reason) return null;
  return {
    startSec: roundTime(start),
    endSec: roundTime(end),
    reason,
    confidence: clampConfidence(row.confidence ?? row.conf),
    source: normalizeSource(row.source),
  };
}

/** Parse model JSON / stored array into normalized ranges. */
export function parsePrivacyRedactions(raw: unknown): PrivacyRedactionRange[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return mergePrivacyRanges(raw.map(parseOneRange).filter(Boolean) as PrivacyRedactionRange[]);
  }
  if (typeof raw === 'object') {
    const obj = raw as StoredPrivacyRedactions & { privacyRedactions?: unknown; ranges?: unknown };
    if (Array.isArray(obj.ranges)) return parsePrivacyRedactions(obj.ranges);
    if (Array.isArray(obj.privacyRedactions)) return parsePrivacyRedactions(obj.privacyRedactions);
  }
  return [];
}

export function privacyRedactionsFromStored(raw: unknown): PrivacyRedactionRange[] {
  return parsePrivacyRedactions(raw);
}

export function toStoredPrivacyRedactions(
  ranges: PrivacyRedactionRange[],
  model?: string | null,
): StoredPrivacyRedactions | null {
  const merged = mergePrivacyRanges(ranges);
  if (!merged.length) return null;
  return {
    version: PRIVACY_REDACTIONS_VERSION,
    ranges: merged,
    model: model ?? null,
  };
}

export function publicPrivacyFields(
  ranges: PrivacyRedactionRange[] | null | undefined,
): { version: number; ranges: PrivacyRedactionRange[] } | null {
  const merged = mergePrivacyRanges(ranges ?? []);
  if (!merged.length) return null;
  return { version: PRIVACY_REDACTIONS_VERSION, ranges: merged };
}

type TimedHint = { tSec: number; text: string };

/**
 * Heuristic detection from timed vision/speech text.
 * Prefers over-redacting when a private space is named.
 */
export function derivePrivacyRedactions(input: {
  durationSeconds?: number | null;
  events?: Array<{ atSeconds?: number | null; text?: string | null; type?: string | null }>;
  peopleNotes?: Array<{ tSec?: number | null; note?: string | null }>;
  narrationText?: string | null;
  summary?: string | null;
  visionRanges?: PrivacyRedactionRange[] | null;
  model?: string | null;
}): PrivacyRedactionRange[] {
  const duration =
    Number.isFinite(Number(input.durationSeconds)) && Number(input.durationSeconds) > 0
      ? Number(input.durationSeconds)
      : null;

  const hints: TimedHint[] = [];
  for (const ev of input.events ?? []) {
    const t = Number(ev.atSeconds);
    const text = String(ev.text || '').trim();
    if (!Number.isFinite(t) || !text) continue;
    if (isPrivateMomentText(text)) hints.push({ tSec: t, text });
  }
  for (const note of input.peopleNotes ?? []) {
    const t = Number(note.tSec);
    const text = String(note.note || '').trim();
    if (!Number.isFinite(t) || !text) continue;
    if (isPrivateMomentText(text)) hints.push({ tSec: t, text });
  }

  // Untimed narration/summary: only when clearly private — pad a short early window.
  const prose = [input.narrationText, input.summary].filter(Boolean).join('\n');
  if (isPrivateMomentText(prose) && !hints.length && !(input.visionRanges?.length)) {
    hints.push({ tSec: 0, text: prose.slice(0, 240) });
  }

  const heuristic: PrivacyRedactionRange[] = [];
  for (const hint of hints) {
    const intimate = INTIMATE_RE.test(hint.text);
    // Lean toward over-redacting private spaces: pad before/after the beat.
    const padBefore = intimate ? 3 : 2;
    const padAfter = intimate ? 45 : 35;
    const start = Math.max(0, hint.tSec - padBefore);
    let end = hint.tSec + padAfter;
    if (duration != null) end = Math.min(duration, end);
    // Minimum window so a single still still blocks seeking through the moment.
    if (end - start < 8) end = Math.min(duration ?? start + 12, start + 12);
    heuristic.push({
      startSec: start,
      endSec: end,
      reason: reasonFromText(hint.text),
      confidence: intimate ? 0.72 : 0.62,
      source: 'heuristic',
    });
  }

  const vision = (input.visionRanges ?? []).map((r) => ({
    ...r,
    source: normalizeSource(r.source) === 'heuristic' ? ('heuristic' as const) : ('vision' as const),
    confidence: clampConfidence(r.confidence < 0.4 ? 0.55 : r.confidence),
  }));

  return mergePrivacyRanges([...vision, ...heuristic]);
}

/** Replace transcript lines whose timestamps fall inside redaction ranges. */
export function redactTranscriptForAsk(
  transcript: string | null | undefined,
  ranges: PrivacyRedactionRange[] | null | undefined,
): string | null {
  const raw = String(transcript || '');
  if (!raw.trim()) return transcript == null ? null : raw;
  if (!ranges?.length) return raw;

  const lineRe = /^\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s*(.*)$/;
  return raw
    .split('\n')
    .map((line) => {
      const m = line.match(lineRe);
      if (!m) return line;
      const hh = m[3] != null ? Number(m[1]) : 0;
      const mm = m[3] != null ? Number(m[2]) : Number(m[1]);
      const ss = m[3] != null ? Number(m[3]) : Number(m[2]);
      const t = hh * 3600 + mm * 60 + ss;
      if (!secondsInPrivacyRange(t, ranges)) return line;
      const prefix = m[3] != null ? `[${m[1]}:${m[2]}:${m[3]}]` : `[${m[1]}:${m[2]}]`;
      const speaker = String(m[4] || '').match(/^([^:]{1,40}:)\s*/);
      return speaker
        ? `${prefix} ${speaker[1]} ${PRIVACY_REDACTED_LABEL}`
        : `${prefix} ${PRIVACY_REDACTED_LABEL}`;
    })
    .join('\n');
}

export function applyPrivacyToEvidenceEntries<
  T extends { atSeconds: number; text: string; type?: string; quote?: string | null },
>(entries: T[], ranges: PrivacyRedactionRange[] | null | undefined): T[] {
  if (!ranges?.length || !entries.length) return entries;
  return entries.map((entry) => {
    if (!secondsInPrivacyRange(entry.atSeconds, ranges)) return entry;
    const type = String(entry.type || '').toLowerCase();
    const speechLike = type === 'said' || type === 'speech' || type === 'decision';
    const privateScene = isPrivateMomentText(entry.text);
    if (!speechLike && !privateScene) return entry;
    return {
      ...entry,
      text: PRIVACY_REDACTED_LABEL,
      quote: speechLike ? PRIVACY_REDACTED_LABEL : entry.quote,
    };
  });
}

/** Hide captions / VTT cues that fall in redacted ranges. */
export function filterSegmentsOutsidePrivacy<
  T extends { startSeconds?: number | null; start?: number | null; text?: string | null },
>(segments: T[] | null | undefined, ranges: PrivacyRedactionRange[] | null | undefined): T[] {
  if (!segments?.length) return [];
  if (!ranges?.length) return [...segments];
  return segments.map((seg) => {
    const t = Number(seg.startSeconds ?? seg.start ?? NaN);
    if (!Number.isFinite(t) || !secondsInPrivacyRange(t, ranges)) return seg;
    return { ...seg, text: PRIVACY_REDACTED_LABEL };
  });
}
