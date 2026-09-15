/**
 * Child privacy redaction for Field Capture / job videos.
 *
 * Protective privacy only: detect presence of people who appear to be minors
 * (child vs adult appearance estimate), persist under
 * `ai_findings.childPrivacyRedactions`, and blur in players.
 *
 * NEVER identify, name, or reverse-search children. NEVER invent detections.
 * Skip cannotTell. Confidence thresholds apply. Parallel to private-moment
 * redaction (`privacyRedactions`) under category `child_privacy`.
 *
 * Phase 1: stored ranges (+ optional region boxes) + client blur.
 * Mute only when the whole frame is redacted (no usable region boxes).
 * Phase 2: server re-encode — see docs/child-privacy-redaction.md.
 */

import {
  mergePrivacyRanges,
  type PrivacyRedactionRange,
  type PrivacyRedactionSource,
} from './privacyRedactions.js';

export const CHILD_PRIVACY_REDACTIONS_VERSION = 1;
export const CHILD_PRIVACY_CATEGORY = 'child_privacy' as const;
export const CHILD_PRIVACY_REDACTED_LABEL = 'child present [privacy redacted]';
/** Minimum confidence to accept a vision/heuristic child detection. */
export const MIN_CHILD_PRIVACY_CONFIDENCE = 0.55;

export type AgeAppearance = 'child' | 'adult' | 'cannotTell';

export type ChildPrivacyRegion = {
  /** Normalized 0–1 box relative to frame. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Optional seek time this box was observed. */
  tSec?: number | null;
};

export type ChildPrivacyRange = PrivacyRedactionRange & {
  category?: typeof CHILD_PRIVACY_CATEGORY;
  /** Optional face/body regions for region blur; absent → full-frame. */
  regions?: ChildPrivacyRegion[];
};

/** Persisted under `ai_findings.childPrivacyRedactions`. */
export type StoredChildPrivacyRedactions = {
  version: number;
  category: typeof CHILD_PRIVACY_CATEGORY;
  ranges: ChildPrivacyRange[];
  model?: string | null;
};

const CHILD_PRESENCE_RE =
  /\b(child|children|kid|kids|toddler|toddlers|infant|infants|baby|babies|preschooler|school[- ]?age|teen(?:ager)?s?|adolescent|minor)\b/i;

/** Avoid false positives from non-person uses of "child". */
const CHILD_FALSE_POSITIVE_RE =
  /\b(child\s+process|child\s+lock|child\s+seat|child[- ]proof|grandchild\s+clause)\b/i;

function roundTime(seconds: number): number {
  return Math.round(Math.max(0, seconds) * 100) / 100;
}

function clamp01(raw: unknown, fallback = 0): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, Math.round(n * 1000) / 1000));
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

export function normalizeAgeAppearance(raw: unknown): AgeAppearance | null {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  if (!s) return null;
  if (
    s === 'child' ||
    s === 'kid' ||
    s === 'minor' ||
    s === 'infant' ||
    s === 'toddler' ||
    s === 'baby' ||
    s === 'teen' ||
    s === 'teenager' ||
    s === 'adolescent'
  ) {
    return 'child';
  }
  if (s === 'adult' || s === 'grownup' || s === 'grown-up') return 'adult';
  if (s === 'cannottell' || s === 'unknown' || s === 'unclear' || s === 'unsure') {
    return 'cannotTell';
  }
  return null;
}

export function isChildPresenceText(text: string | null | undefined): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  if (CHILD_FALSE_POSITIVE_RE.test(t)) return false;
  return CHILD_PRESENCE_RE.test(t);
}

export function reasonFromChildText(text: string): string {
  const t = text.trim();
  if (/\b(infant|baby|babies)\b/i.test(t)) return 'infant / baby present';
  if (/\b(toddler)\b/i.test(t)) return 'toddler present';
  if (/\b(teen(?:ager)?|adolescent)\b/i.test(t)) return 'teen present';
  return 'child present';
}

export function secondsInChildPrivacyRange(
  tSec: number,
  ranges: ChildPrivacyRange[] | null | undefined,
): ChildPrivacyRange | null {
  if (!Number.isFinite(tSec) || !ranges?.length) return null;
  for (const r of ranges) {
    if (tSec >= r.startSec && tSec < r.endSec) return r;
    if (Math.abs(tSec - r.endSec) < 0.05) return r;
  }
  return null;
}

function parseRegion(raw: unknown): ChildPrivacyRegion | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const x = clamp01(row.x ?? row.left, NaN);
  const y = clamp01(row.y ?? row.top, NaN);
  const w = clamp01(row.w ?? row.width, NaN);
  const h = clamp01(row.h ?? row.height, NaN);
  if (![x, y, w, h].every((n) => Number.isFinite(n)) || w <= 0.01 || h <= 0.01) return null;
  const tRaw = row.tSec ?? row.t_sec ?? row.atSeconds;
  const tSec =
    tRaw == null || tRaw === ''
      ? null
      : Number.isFinite(Number(tRaw))
        ? roundTime(Number(tRaw))
        : null;
  return { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y), tSec };
}

function parseOneRange(raw: unknown): ChildPrivacyRange | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const age = normalizeAgeAppearance(row.ageAppearance ?? row.age_appearance ?? row.ageBand);
  if (age === 'cannotTell' || age === 'adult') return null;

  const start = Number(
    row.startSec ?? row.start_sec ?? row.startSeconds ?? row.t_start ?? row.fromSec ?? row.start,
  );
  const end = Number(
    row.endSec ?? row.end_sec ?? row.endSeconds ?? row.t_end ?? row.toSec ?? row.end,
  );
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  if (end - start > 3600) return null;

  const confidence = clampConfidence(row.confidence ?? row.conf);
  if (confidence < MIN_CHILD_PRIVACY_CONFIDENCE) return null;

  const reasonRaw = String(row.reason ?? row.label ?? row.description ?? 'child present')
    .trim()
    .slice(0, 200);
  const reason = isChildPresenceText(reasonRaw) ? reasonFromChildText(reasonRaw) : 'child present';

  const regionsRaw = row.regions ?? row.boxes ?? row.faces;
  const regions = Array.isArray(regionsRaw)
    ? (regionsRaw.map(parseRegion).filter(Boolean) as ChildPrivacyRegion[]).slice(0, 8)
    : [];

  return {
    startSec: roundTime(start),
    endSec: roundTime(end),
    reason,
    confidence,
    source: normalizeSource(row.source),
    category: CHILD_PRIVACY_CATEGORY,
    regions: regions.length ? regions : undefined,
  };
}

function mergeChildRanges(ranges: ChildPrivacyRange[]): ChildPrivacyRange[] {
  if (!ranges.length) return [];
  const sorted = [...ranges]
    .filter((r) => Number.isFinite(r.startSec) && Number.isFinite(r.endSec) && r.endSec > r.startSec)
    .filter((r) => r.confidence >= MIN_CHILD_PRIVACY_CONFIDENCE)
    .map((r) => ({
      ...r,
      startSec: roundTime(r.startSec),
      endSec: roundTime(r.endSec),
      confidence: clampConfidence(r.confidence),
      reason: String(r.reason || 'child present').slice(0, 200),
      source: normalizeSource(r.source),
      category: CHILD_PRIVACY_CATEGORY as typeof CHILD_PRIVACY_CATEGORY,
      regions: Array.isArray(r.regions)
        ? (r.regions.map(parseRegion).filter(Boolean).slice(0, 8) as ChildPrivacyRegion[])
        : undefined,
    }))
    .sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);

  const out: ChildPrivacyRange[] = [];
  for (const next of sorted) {
    const prev = out[out.length - 1];
    if (!prev || next.startSec > prev.endSec + 1.5) {
      out.push({
        ...next,
        regions: next.regions?.length ? [...next.regions] : undefined,
      });
      continue;
    }
    prev.endSec = Math.max(prev.endSec, next.endSec);
    prev.startSec = Math.min(prev.startSec, next.startSec);
    prev.confidence = Math.max(prev.confidence, next.confidence);
    if (prev.source !== next.source) prev.source = 'merged';
    if (next.reason && next.reason.length > prev.reason.length) prev.reason = next.reason;
    const combined = [...(prev.regions ?? []), ...(next.regions ?? [])].slice(0, 8);
    prev.regions = combined.length ? combined : undefined;
  }
  return out.slice(0, 64);
}

/** Parse model JSON / stored array into normalized child privacy ranges. */
export function parseChildPrivacyRedactions(raw: unknown): ChildPrivacyRange[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return mergeChildRanges(raw.map(parseOneRange).filter(Boolean) as ChildPrivacyRange[]);
  }
  if (typeof raw === 'object') {
    const obj = raw as StoredChildPrivacyRedactions & {
      childPrivacyRedactions?: unknown;
      ranges?: unknown;
    };
    if (Array.isArray(obj.ranges)) return parseChildPrivacyRedactions(obj.ranges);
    if (Array.isArray(obj.childPrivacyRedactions)) {
      return parseChildPrivacyRedactions(obj.childPrivacyRedactions);
    }
  }
  return [];
}

export function childPrivacyRedactionsFromStored(raw: unknown): ChildPrivacyRange[] {
  return parseChildPrivacyRedactions(raw);
}

export function toStoredChildPrivacyRedactions(
  ranges: ChildPrivacyRange[],
  model?: string | null,
): StoredChildPrivacyRedactions | null {
  const merged = mergeChildRanges(ranges);
  if (!merged.length) return null;
  return {
    version: CHILD_PRIVACY_REDACTIONS_VERSION,
    category: CHILD_PRIVACY_CATEGORY,
    ranges: merged,
    model: model ?? null,
  };
}

export function publicChildPrivacyFields(
  ranges: ChildPrivacyRange[] | null | undefined,
): { version: number; category: typeof CHILD_PRIVACY_CATEGORY; ranges: ChildPrivacyRange[] } | null {
  const merged = mergeChildRanges(ranges ?? []);
  if (!merged.length) return null;
  return {
    version: CHILD_PRIVACY_REDACTIONS_VERSION,
    category: CHILD_PRIVACY_CATEGORY,
    ranges: merged,
  };
}

/**
 * True when the active child range should mute audio (whole-frame redaction).
 * Region-only ranges prefer blur without mute.
 */
export function childRangeMutesAudio(range: ChildPrivacyRange | null | undefined): boolean {
  if (!range) return false;
  const regions = range.regions ?? [];
  return regions.length === 0;
}

type TimedHint = { tSec: number; text: string; age?: AgeAppearance | null };

/**
 * Heuristic + vision child detection. Never invents; skips cannotTell;
 * drops low confidence.
 */
export function deriveChildPrivacyRedactions(input: {
  durationSeconds?: number | null;
  events?: Array<{ atSeconds?: number | null; text?: string | null; type?: string | null }>;
  peopleNotes?: Array<{
    tSec?: number | null;
    note?: string | null;
    ageAppearance?: unknown;
  }>;
  narrationText?: string | null;
  summary?: string | null;
  visionRanges?: ChildPrivacyRange[] | null;
  model?: string | null;
  /** When false, skip detection entirely (org policy off). */
  enabled?: boolean;
}): ChildPrivacyRange[] {
  if (input.enabled === false) return [];

  const duration =
    Number.isFinite(Number(input.durationSeconds)) && Number(input.durationSeconds) > 0
      ? Number(input.durationSeconds)
      : null;

  const hints: TimedHint[] = [];
  for (const ev of input.events ?? []) {
    const t = Number(ev.atSeconds);
    const text = String(ev.text || '').trim();
    if (!Number.isFinite(t) || !text) continue;
    if (isChildPresenceText(text)) hints.push({ tSec: t, text, age: 'child' });
  }
  for (const note of input.peopleNotes ?? []) {
    const t = Number(note.tSec);
    const age = normalizeAgeAppearance(note.ageAppearance);
    if (age === 'cannotTell' || age === 'adult') continue;
    const text = String(note.note || '').trim();
    const childByAge = age === 'child';
    const childByText = isChildPresenceText(text);
    if (!childByAge && !childByText) continue;
    if (!Number.isFinite(t)) continue;
    hints.push({
      tSec: t,
      text: text || 'child present',
      age: 'child',
    });
  }

  const prose = [input.narrationText, input.summary].filter(Boolean).join('\n');
  if (isChildPresenceText(prose) && !hints.length && !(input.visionRanges?.length)) {
    hints.push({ tSec: 0, text: prose.slice(0, 240), age: 'child' });
  }

  const heuristic: ChildPrivacyRange[] = [];
  for (const hint of hints) {
    const padBefore = 2;
    const padAfter = 28;
    const start = Math.max(0, hint.tSec - padBefore);
    let end = hint.tSec + padAfter;
    if (duration != null) end = Math.min(duration, end);
    if (end - start < 8) end = Math.min(duration ?? start + 12, start + 12);
    heuristic.push({
      startSec: start,
      endSec: end,
      reason: reasonFromChildText(hint.text),
      confidence: 0.62,
      source: 'heuristic',
      category: CHILD_PRIVACY_CATEGORY,
    });
  }

  const vision = (input.visionRanges ?? [])
    .map((r) => ({
      ...r,
      source:
        normalizeSource(r.source) === 'heuristic'
          ? ('heuristic' as const)
          : ('vision' as const),
      confidence: clampConfidence(r.confidence),
      category: CHILD_PRIVACY_CATEGORY as typeof CHILD_PRIVACY_CATEGORY,
    }))
    .filter((r) => r.confidence >= MIN_CHILD_PRIVACY_CONFIDENCE);

  return mergeChildRanges([...vision, ...heuristic]);
}

/** Replace transcript lines whose timestamps fall inside child privacy ranges. */
export function redactTranscriptForChildPrivacy(
  transcript: string | null | undefined,
  ranges: ChildPrivacyRange[] | null | undefined,
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
      if (!secondsInChildPrivacyRange(t, ranges)) return line;
      const prefix = m[3] != null ? `[${m[1]}:${m[2]}:${m[3]}]` : `[${m[1]}:${m[2]}]`;
      const speaker = String(m[4] || '').match(/^([^:]{1,40}:)\s*/);
      return speaker
        ? `${prefix} ${speaker[1]} ${CHILD_PRIVACY_REDACTED_LABEL}`
        : `${prefix} ${CHILD_PRIVACY_REDACTED_LABEL}`;
    })
    .join('\n');
}

export function applyChildPrivacyToEvidenceEntries<
  T extends { atSeconds: number; text: string; type?: string; quote?: string | null },
>(entries: T[], ranges: ChildPrivacyRange[] | null | undefined): T[] {
  if (!ranges?.length || !entries.length) return entries;
  return entries.map((entry) => {
    if (!secondsInChildPrivacyRange(entry.atSeconds, ranges)) {
      if (
        isChildPresenceText(entry.text) &&
        /\b(named|called|wearing|face|hair|eyes)\b/i.test(entry.text)
      ) {
        return { ...entry, text: CHILD_PRIVACY_REDACTED_LABEL };
      }
      return entry;
    }
    const type = String(entry.type || '').toLowerCase();
    const speechLike = type === 'said' || type === 'speech' || type === 'decision';
    const childScene = isChildPresenceText(entry.text) || type === 'person' || type === 'people';
    if (!speechLike && !childScene) {
      if (/\b(child|kid|toddler|infant|baby|teen)\b/i.test(entry.text)) {
        return { ...entry, text: CHILD_PRIVACY_REDACTED_LABEL };
      }
      return entry;
    }
    return {
      ...entry,
      text: CHILD_PRIVACY_REDACTED_LABEL,
      quote: speechLike ? CHILD_PRIVACY_REDACTED_LABEL : entry.quote,
    };
  });
}

/** Combine private-moment + child ranges for overlap checks (e.g. motion clips). */
export function combinedPrivacyRangesForOverlap(
  privateRanges: PrivacyRedactionRange[] | null | undefined,
  childRanges: ChildPrivacyRange[] | null | undefined,
): PrivacyRedactionRange[] {
  return mergePrivacyRanges([
    ...(privateRanges ?? []),
    ...(childRanges ?? []).map((r) => ({
      startSec: r.startSec,
      endSec: r.endSec,
      reason: r.reason,
      confidence: r.confidence,
      source: r.source,
    })),
  ]);
}
