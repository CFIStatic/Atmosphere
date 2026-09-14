/**
 * Robotics-ready motion clips — skill-corpus foundation (Internal only).
 *
 * Label narrow trade motions (screw, cut, measure, …) from verified proof
 * actions / vision evidence. Persist timed segments on the proof under
 * `ai_findings.motionClips`. Privacy ranges are excluded entirely.
 * Browse UI and APIs are Jettx/Internal staff — not the customer job file.
 *
 * Never invent a motion without evidence: no description → drop; unknown
 * verb stays out of the corpus (not forced into a neighbour).
 */

import {
  isWorkAction,
  normaliseAction,
  type WorkAction,
  WORK_ACTIONS,
} from '../episodes/actions.js';
import {
  privacyRedactionsFromStored,
  type PrivacyRedactionRange,
} from '../audio/privacyRedactions.js';
import type { VisionAction } from './proofActions.js';

export const MOTION_CLIPS_VERSION = 1;
export const MOTION_CLIPS_SCHEMA = 'atmosphere.motion_clips.v1' as const;

/** Minimum model confidence to admit a clip into the corpus. */
export const MIN_MOTION_CONFIDENCE = 0.45;

/** When vision only gave a point timestamp, use this short window (seconds). */
export const POINT_CLIP_SECONDS = 2;

/** Soft cap per proof — keeps browse / export bounded. */
export const MAX_MOTION_CLIPS_PER_PROOF = 64;

/**
 * Narrow motion labels preferred for robotics / skill cards when evidence
 * supports them. Each maps onto the closed WORK_ACTIONS vocabulary.
 */
export const NARROW_MOTION_ALIASES: Record<string, WorkAction> = {
  screw: 'fasten',
  screwing: 'fasten',
  screwdriver: 'fasten',
  nail: 'fasten',
  nailing: 'fasten',
  bolt: 'fasten',
  bolting: 'fasten',
  clamp: 'fasten',
  clamping: 'fasten',
  cut: 'cut',
  cutting: 'cut',
  saw: 'cut',
  sawing: 'cut',
  trim: 'cut',
  trimming: 'cut',
  measure: 'measure',
  measuring: 'measure',
  tape_measure: 'measure',
  drill: 'drill',
  drilling: 'drill',
  mark: 'mark',
  marking: 'mark',
  align: 'align',
  aligning: 'align',
  position: 'position',
  positioning: 'position',
  apply: 'apply',
  caulk: 'apply',
  caulking: 'apply',
  paint: 'apply',
  painting: 'apply',
  solder: 'connect',
  soldering: 'connect',
  weld: 'connect',
  welding: 'connect',
  glue: 'connect',
  gluing: 'connect',
  crimp: 'connect',
  crimping: 'connect',
  inspect: 'inspect',
  inspecting: 'inspect',
  test: 'test',
  testing: 'test',
  remove: 'remove',
  demo: 'remove',
  demolish: 'remove',
  clean: 'clean',
  cleaning: 'clean',
  protect: 'protect',
  masking: 'protect',
  carry: 'carry',
  pick_up: 'pick_up',
  pickup: 'pick_up',
  locate: 'locate',
  correct: 'correct',
};

/** Motions that are not useful as a robotics skill clip. */
const SKIP_ACTIONS = new Set<WorkAction>(['wait', 'other']);

export type MotionClipSource = 'ai_vision' | 'verified_action';

export type MotionClip = {
  startSec: number;
  endSec: number;
  /** Closed vocabulary verb. */
  action: WorkAction;
  /** Narrow label when evidence supports it (e.g. screw); else action. */
  motion: string;
  description: string;
  toolLabel: string | null;
  objectLabel: string | null;
  materialLabel: string | null;
  room: string | null;
  confidence: number;
  source: MotionClipSource;
  /** True when end was inferred from a point timestamp. */
  durationInferred: boolean;
  model?: string | null;
};

/** Persisted under `ai_findings.motionClips`. */
export type StoredMotionClips = {
  version: number;
  schema: typeof MOTION_CLIPS_SCHEMA;
  clips: MotionClip[];
  /** How many candidate actions were dropped for privacy overlap. */
  excludedForPrivacy: number;
  model?: string | null;
  updatedAt?: string;
};

export type MotionClipBrowseItem = MotionClip & {
  proofId: string;
  jobId: string;
  orgId: string;
  workDate: string | null;
  phase: string | null;
  jobTitle?: string | null;
  company?: string | null;
};

export type MotionTypeBucket = {
  motion: string;
  action: WorkAction | null;
  count: number;
  clips: MotionClipBrowseItem[];
};

function roundTime(seconds: number): number {
  return Math.round(Math.max(0, seconds) * 100) / 100;
}

function clampConfidence(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, Math.round(n * 100) / 100));
}

function cleanLabel(value: unknown, max = 80): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed || null;
}

function tokenizeEvidence(...parts: Array<string | null | undefined>): string[] {
  const blob = parts.filter(Boolean).join(' ').toLowerCase();
  return blob.match(/[a-z][a-z0-9_]{1,24}/g) ?? [];
}

/**
 * Pick a narrow motion label from evidence text / tool / action.
 * Returns null when nothing evidence-backed matches — caller must not invent.
 */
export function narrowMotionFromEvidence(input: {
  action?: string | null;
  description?: string | null;
  toolLabel?: string | null;
  objectLabel?: string | null;
}): { motion: string; action: WorkAction } | null {
  const actionNorm =
    (typeof input.action === 'string' && normaliseAction(input.action)) ||
    (typeof input.action === 'string' && isWorkAction(input.action.trim().toLowerCase())
      ? (input.action.trim().toLowerCase() as WorkAction)
      : null);

  const tokens = tokenizeEvidence(input.description, input.toolLabel, input.objectLabel, input.action);
  for (const token of tokens) {
    const mapped = NARROW_MOTION_ALIASES[token] ?? normaliseAction(token);
    if (!mapped || SKIP_ACTIONS.has(mapped)) continue;

    // Canonical narrow label: prefer non-gerund alias key when present.
    let narrow: string = mapped;
    if (NARROW_MOTION_ALIASES[token]) {
      if (token.endsWith('ing')) {
        const stem = token.slice(0, -3);
        if (NARROW_MOTION_ALIASES[stem]) narrow = stem;
        else if (NARROW_MOTION_ALIASES[`${stem}e`]) narrow = `${stem}e`;
        else narrow = mapped; // cutting → cut via mapped action when no stem alias
      } else if (token === 'screwdriver' || token === 'tape_measure') {
        narrow = token === 'screwdriver' ? 'screw' : 'measure';
      } else {
        narrow = token.replace(/_/g, ' ');
      }
    }

    return { motion: narrow, action: mapped };
  }

  if (actionNorm && !SKIP_ACTIONS.has(actionNorm)) {
    return { motion: actionNorm, action: actionNorm };
  }
  return null;
}

function rangesOverlap(
  startSec: number,
  endSec: number,
  ranges: PrivacyRedactionRange[] | null | undefined,
): boolean {
  if (!ranges?.length) return false;
  const a0 = startSec;
  const a1 = Math.max(startSec, endSec);
  for (const r of ranges) {
    const b0 = r.startSec;
    const b1 = Math.max(r.startSec, r.endSec);
    if (a0 < b1 && b0 < a1) return true;
  }
  return false;
}

/**
 * Build motion clips from vision / proof actions. Drops inventable empties,
 * low-confidence rows, wait/other, and anything overlapping privacy ranges.
 */
export function deriveMotionClips(
  actions: Array<Partial<VisionAction> & { description?: string; action?: string }>,
  opts?: {
    privacyRanges?: PrivacyRedactionRange[] | null;
    model?: string | null;
    minConfidence?: number;
  },
): { clips: MotionClip[]; excludedForPrivacy: number } {
  const minConf = opts?.minConfidence ?? MIN_MOTION_CONFIDENCE;
  const ranges = opts?.privacyRanges ?? [];
  const clips: MotionClip[] = [];
  let excludedForPrivacy = 0;
  const seen = new Set<string>();

  for (const raw of actions) {
    if (!raw || typeof raw !== 'object') continue;
    const description = cleanLabel(raw.description, 400);
    if (!description) continue;

    const confidence = clampConfidence(raw.confidence);
    if (confidence < minConf) continue;

    const narrow = narrowMotionFromEvidence({
      action: typeof raw.action === 'string' ? raw.action : null,
      description,
      toolLabel: raw.toolLabel ?? null,
      objectLabel: raw.objectLabel ?? null,
    });
    if (!narrow) continue;

    const startSec = roundTime(
      typeof raw.atSeconds === 'number' && Number.isFinite(raw.atSeconds) ? raw.atSeconds : 0,
    );
    let endSec: number;
    let durationInferred = false;
    if (typeof raw.endSeconds === 'number' && Number.isFinite(raw.endSeconds) && raw.endSeconds >= startSec) {
      endSec = roundTime(raw.endSeconds);
    } else {
      endSec = roundTime(startSec + POINT_CLIP_SECONDS);
      durationInferred = true;
    }
    if (endSec <= startSec) {
      endSec = roundTime(startSec + POINT_CLIP_SECONDS);
      durationInferred = true;
    }

    if (rangesOverlap(startSec, endSec, ranges)) {
      excludedForPrivacy += 1;
      continue;
    }

    const key = `${startSec}|${endSec}|${narrow.motion}|${description.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    clips.push({
      startSec,
      endSec,
      action: narrow.action,
      motion: narrow.motion,
      description,
      toolLabel: cleanLabel(raw.toolLabel),
      objectLabel: cleanLabel(raw.objectLabel),
      materialLabel: cleanLabel(raw.materialLabel),
      room: cleanLabel(raw.room),
      confidence,
      source: 'ai_vision',
      durationInferred,
      model: cleanLabel(raw.model, 80) ?? opts?.model ?? null,
    });

    if (clips.length >= MAX_MOTION_CLIPS_PER_PROOF) break;
  }

  clips.sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
  return { clips, excludedForPrivacy };
}

export function toStoredMotionClips(
  clips: MotionClip[],
  opts?: { excludedForPrivacy?: number; model?: string | null; updatedAt?: string },
): StoredMotionClips {
  return {
    version: MOTION_CLIPS_VERSION,
    schema: MOTION_CLIPS_SCHEMA,
    clips: clips.slice(0, MAX_MOTION_CLIPS_PER_PROOF),
    excludedForPrivacy: opts?.excludedForPrivacy ?? 0,
    model: opts?.model ?? null,
    updatedAt: opts?.updatedAt ?? new Date().toISOString(),
  };
}

export function motionClipsFromStored(raw: unknown): StoredMotionClips | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const list = Array.isArray(obj.clips)
    ? obj.clips
    : Array.isArray(obj)
      ? obj
      : Array.isArray((obj as { motionClips?: unknown }).motionClips)
        ? ((obj as { motionClips: unknown[] }).motionClips)
        : null;
  if (!list) return null;

  // Re-apply stored clips faithfully when they already look like MotionClip.
  const faithful: MotionClip[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const description = cleanLabel(row.description, 400);
    if (!description) continue;
    const actionRaw = typeof row.action === 'string' ? row.action : null;
    const action = (actionRaw && normaliseAction(actionRaw)) || (actionRaw && isWorkAction(actionRaw) ? (actionRaw as WorkAction) : null);
    if (!action || SKIP_ACTIONS.has(action)) continue;
    const motion =
      cleanLabel(row.motion, 40)?.toLowerCase() ||
      action;
    const startSec = roundTime(Number(row.startSec ?? row.atSeconds ?? 0) || 0);
    const endRaw = Number(row.endSec ?? row.endSeconds);
    const durationInferred = !(Number.isFinite(endRaw) && endRaw >= startSec) || Boolean(row.durationInferred);
    const endSec = Number.isFinite(endRaw) && endRaw >= startSec ? roundTime(endRaw) : roundTime(startSec + POINT_CLIP_SECONDS);
    faithful.push({
      startSec,
      endSec,
      action,
      motion,
      description,
      toolLabel: cleanLabel(row.toolLabel),
      objectLabel: cleanLabel(row.objectLabel),
      materialLabel: cleanLabel(row.materialLabel),
      room: cleanLabel(row.room),
      confidence: clampConfidence(row.confidence),
      source: row.source === 'verified_action' ? 'verified_action' : 'ai_vision',
      durationInferred,
      model: cleanLabel(row.model, 80),
    });
    if (faithful.length >= MAX_MOTION_CLIPS_PER_PROOF) break;
  }

  if (!faithful.length) return null;
  return toStoredMotionClips(faithful, {
    excludedForPrivacy:
      typeof obj.excludedForPrivacy === 'number' ? obj.excludedForPrivacy : 0,
    model: typeof obj.model === 'string' ? obj.model : null,
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : undefined,
  });
}

export function publicMotionClipsFields(stored: StoredMotionClips | null): {
  version: number;
  schema: typeof MOTION_CLIPS_SCHEMA;
  clips: MotionClip[];
  excludedForPrivacy: number;
  count: number;
} | null {
  if (!stored || !stored.clips.length) {
    if (!stored) return null;
    return {
      version: stored.version,
      schema: MOTION_CLIPS_SCHEMA,
      clips: [],
      excludedForPrivacy: stored.excludedForPrivacy,
      count: 0,
    };
  }
  return {
    version: stored.version,
    schema: MOTION_CLIPS_SCHEMA,
    clips: stored.clips,
    excludedForPrivacy: stored.excludedForPrivacy,
    count: stored.clips.length,
  };
}

export function motionClipsFromProofRow(row: {
  actions?: unknown;
  ai_findings?: unknown;
}): StoredMotionClips | null {
  const findings =
    row.ai_findings && typeof row.ai_findings === 'object'
      ? (row.ai_findings as Record<string, unknown>)
      : {};
  const stored = motionClipsFromStored(findings.motionClips);
  if (stored?.clips.length) return stored;

  const privacy = privacyRedactionsFromStored(findings.privacyRedactions);
  const actions = Array.isArray(row.actions)
    ? row.actions
    : Array.isArray(findings.actions)
      ? findings.actions
      : [];
  const derived = deriveMotionClips(actions as VisionAction[], { privacyRanges: privacy });
  if (!derived.clips.length && !derived.excludedForPrivacy) return null;
  return toStoredMotionClips(derived.clips, {
    excludedForPrivacy: derived.excludedForPrivacy,
  });
}

/** Group browse items by narrow motion type for Internal / Platform filters. */
export function bucketMotionClipsByType(
  items: MotionClipBrowseItem[],
  opts?: { motion?: string | null; limitPerType?: number },
): MotionTypeBucket[] {
  const filter = opts?.motion?.trim().toLowerCase() || null;
  const limit = opts?.limitPerType ?? 40;
  const map = new Map<string, MotionTypeBucket>();

  for (const item of items) {
    const key = item.motion.trim().toLowerCase();
    if (!key) continue;
    if (filter && key !== filter && item.action !== filter) continue;
    let bucket = map.get(key);
    if (!bucket) {
      bucket = { motion: key, action: item.action, count: 0, clips: [] };
      map.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.clips.length < limit) bucket.clips.push(item);
  }

  return [...map.values()].sort((a, b) => b.count - a.count || a.motion.localeCompare(b.motion));
}

export function listKnownMotionTypes(): Array<{ motion: string; action: WorkAction }> {
  const out: Array<{ motion: string; action: WorkAction }> = [];
  const seen = new Set<string>();
  for (const [motion, action] of Object.entries(NARROW_MOTION_ALIASES)) {
    if (motion.endsWith('ing')) continue;
    if (seen.has(motion)) continue;
    seen.add(motion);
    out.push({ motion, action });
  }
  for (const action of WORK_ACTIONS) {
    if (SKIP_ACTIONS.has(action) || seen.has(action)) continue;
    seen.add(action);
    out.push({ motion: action, action });
  }
  return out.sort((a, b) => a.motion.localeCompare(b.motion));
}
