/**
 * Structured work-action log for a filed day film.
 *
 * The office already gets prose dictation. This is the queryable half: each
 * row is a moment in the iOS (or Field Capture) recording, a closed verb from
 * the episode vocabulary, and a sentence of what the model saw being done.
 * Persistence is additive — a failed write must never fail the narration.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { normaliseAction, type WorkAction } from '../episodes/actions.js';
import { rescoreEpisode } from '../episodes/attach.js';

export const MAX_PROOF_ACTIONS = 48;

export interface VisionAction {
  atSeconds: number;
  endSeconds?: number;
  action: WorkAction;
  description: string;
  objectLabel: string | null;
  toolLabel: string | null;
  materialLabel: string | null;
  objects: string[];
  confidence: number;
  model: string | null;
}

export interface StoredProofAction extends VisionAction {
  source: 'ai_vision';
}

const ACTION_WORD = /\b[a-z_]{3,20}\b/g;

function clampConfidence(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

function nearestTimestamp(raw: unknown, frames?: number[]): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  const seconds = Number.isFinite(n) && n >= 0 ? n : 0;
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

function cleanLabel(value: unknown, max = 80): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed || null;
}

function cleanObjects(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const next = item.trim().toLowerCase().slice(0, 60);
    if (!next || seen.has(next)) continue;
    seen.add(next);
    out.push(next);
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * Map free text onto the closed action vocabulary. Unmatched text becomes
 * `other` so the original description stays visible instead of being forced
 * into the nearest verb.
 */
const INFER_ALIASES: Record<string, WorkAction> = {
  cutting: 'cut',
  cuts: 'cut',
  stripping: 'remove',
  stripped: 'remove',
  pulling: 'remove',
  pulled: 'remove',
  installing: 'position',
  installed: 'position',
  hanging: 'position',
  painting: 'apply',
  priming: 'apply',
  inspecting: 'inspect',
  measuring: 'measure',
  drilling: 'drill',
  fastening: 'fasten',
  cleaning: 'clean',
};

export function inferActionFromText(text: string): WorkAction {
  const direct = normaliseAction(text);
  if (direct) return direct;

  const lower = text.toLowerCase();
  const words = lower.match(ACTION_WORD) ?? [];
  for (const word of words) {
    const mapped = normaliseAction(word) ?? INFER_ALIASES[word] ?? null;
    if (mapped) return mapped;
  }
  if (/\b(demo|demolish|tear[ -]?outs?|strip(?:ped|ping)?|pull(?:ing|ed)? out|extract(?:ion)?)\b/.test(lower)) {
    return 'remove';
  }
  if (/\b(install(?:ing|ed)?|hang(?:ing|ed)?|set in place|put up)\b/.test(lower)) return 'position';
  if (/\b(paint(?:ing|ed)?|prime(?:d|ing)?|tape|mud|caulk)\b/.test(lower)) return 'apply';
  return 'other';
}

function asVisionAction(
  raw: Record<string, unknown>,
  opts: { frames?: number[]; model?: string | null },
): VisionAction | null {
  const description = cleanLabel(raw.description ?? raw.note ?? raw.summary, 400);
  if (!description) return null;

  const actionRaw = typeof raw.action === 'string' ? raw.action : description;
  const action = inferActionFromText(actionRaw);
  const atSeconds = nearestTimestamp(raw.atSeconds ?? raw.at_seconds ?? raw.startSeconds, opts.frames);
  const endRaw = raw.endSeconds ?? raw.end_seconds;
  const endSeconds =
    endRaw === undefined || endRaw === null
      ? undefined
      : Math.max(atSeconds, nearestTimestamp(endRaw, opts.frames));

  const objectLabel = cleanLabel(raw.objectLabel ?? raw.object ?? raw.object_label);
  const toolLabel = cleanLabel(raw.toolLabel ?? raw.tool ?? raw.tool_label);
  const materialLabel = cleanLabel(raw.materialLabel ?? raw.material ?? raw.material_label);
  const objects = cleanObjects(raw.objects);
  if (objectLabel && !objects.includes(objectLabel.toLowerCase())) {
    objects.unshift(objectLabel.toLowerCase());
  }

  return {
    atSeconds,
    endSeconds,
    action,
    description,
    objectLabel,
    toolLabel,
    materialLabel,
    objects: objects.slice(0, 8),
    confidence: clampConfidence(raw.confidence),
    model: opts.model ?? cleanLabel(raw.model, 80),
  };
}

/** Parse a model `actions` array. Unknown shapes are dropped, never guessed. */
export function parseVisionActions(
  raw: unknown,
  opts?: { frames?: number[]; model?: string | null },
): VisionAction[] {
  if (!Array.isArray(raw)) return [];
  const out: VisionAction[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const parsed = asVisionAction(item as Record<string, unknown>, opts ?? {});
    if (!parsed) continue;
    const key = `${parsed.atSeconds}|${parsed.action}|${parsed.description.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(parsed);
    if (out.length >= MAX_PROOF_ACTIONS) break;
  }
  return out.sort((a, b) => a.atSeconds - b.atSeconds);
}

export function actionsFromNarrationEntries(
  entries: Array<{ atSeconds: number; note: string }>,
  opts?: { model?: string | null },
): VisionAction[] {
  return parseVisionActions(
    entries.map((entry) => ({
      atSeconds: entry.atSeconds,
      action: inferActionFromText(entry.note),
      description: entry.note,
      confidence: 0.55,
    })),
    { model: opts?.model ?? null },
  );
}

export function actionsFromLongWindows(
  windows: Array<{
    startSeconds: number;
    endSeconds: number;
    reading: { summary: string; activity: string[] } | null;
  }>,
  opts?: { model?: string | null },
): VisionAction[] {
  const raw: Array<Record<string, unknown>> = [];
  for (const window of windows) {
    if (!window.reading) continue;
    const activities = window.reading.activity.length ? window.reading.activity : [window.reading.summary];
    for (const activity of activities.slice(0, 4)) {
      raw.push({
        atSeconds: window.startSeconds,
        endSeconds: window.endSeconds,
        action: inferActionFromText(activity),
        description: window.reading.summary,
        objects: [activity],
        confidence: 0.6,
      });
    }
  }
  return parseVisionActions(raw, { model: opts?.model ?? null });
}

export function storedProofActions(actions: VisionAction[], model?: string | null): StoredProofAction[] {
  return actions.slice(0, MAX_PROOF_ACTIONS).map((action) => ({
    ...action,
    model: action.model ?? model ?? null,
    source: 'ai_vision' as const,
  }));
}

export function actionLabels(actions: VisionAction[]): string[] {
  const labels = new Set<string>();
  for (const action of actions) {
    labels.add(`action:${action.action}`);
    if (action.objectLabel) labels.add(action.objectLabel.toLowerCase().slice(0, 40));
  }
  return [...labels];
}

/**
 * Write the structured log onto the proof and, when an episode exists, onto
 * episode_actions. Failures are swallowed — the prose narration is the record
 * the crew already got; this is enrichment.
 */
export async function persistProofActions(
  admin: any,
  input: {
    orgId: string;
    proofId: string;
    actions: VisionAction[];
    model?: string | null;
    capturedAt?: string | null;
  },
): Promise<void> {
  const actions = storedProofActions(input.actions, input.model);
  try {
    await admin.from('job_proofs').update({ actions }).eq('id', input.proofId);
  } catch {
    return;
  }

  try {
    const { data: observation } = await admin
      .from('episode_observations')
      .select('episode_id')
      .eq('proof_id', input.proofId)
      .maybeSingle();
    const episodeId = observation?.episode_id as string | undefined;
    if (!episodeId) return;

    await admin.from('episode_actions').delete().eq('proof_id', input.proofId).eq('label_source', 'ai');

    const { data: last } = await admin
      .from('episode_actions')
      .select('sequence')
      .eq('episode_id', episodeId)
      .order('sequence', { ascending: false })
      .limit(1)
      .maybeSingle();
    let sequence = Number(last?.sequence ?? 0) + 1;
    const capturedAt = input.capturedAt ? Date.parse(input.capturedAt) : NaN;

    for (const action of actions) {
      const startedAt = Number.isFinite(capturedAt)
        ? new Date((capturedAt as number) + action.atSeconds * 1000).toISOString()
        : null;
      const endedAt =
        Number.isFinite(capturedAt) && action.endSeconds !== undefined
          ? new Date((capturedAt as number) + action.endSeconds * 1000).toISOString()
          : startedAt;
      await admin.from('episode_actions').insert({
        episode_id: episodeId,
        org_id: input.orgId,
        sequence: sequence++,
        action: action.action,
        object_label: action.objectLabel,
        tool_label: action.toolLabel,
        material_label: action.materialLabel,
        start_seconds: action.atSeconds,
        end_seconds: action.endSeconds ?? action.atSeconds,
        proof_id: input.proofId,
        purpose: action.description,
        started_at: startedAt,
        ended_at: endedAt,
        label_source: 'ai',
        confidence: action.confidence,
      });
    }

    await rescoreEpisode(admin, episodeId);
  } catch {
    /* episode write is derived; the proof.actions column is the source of truth */
  }
}
