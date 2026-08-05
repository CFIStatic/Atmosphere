import { anthropicClient, isModelProviderConfigured } from '../lib/anthropic.js';
import { config } from '../config.js';

/**
 * The model, watching the filming itself.
 *
 * Two jobs, one vocabulary. **Observe** is live: a single frame sampled from
 * the camera while the crew records, answered with which stage of the capture
 * guide is on screen right now — so the person filming sees "you are on step
 * 2" while they can still do something about it. **Narrate** is the durable
 * half: after a video is filed, the model reads its frames in order and writes
 * the report that gets attached to that video — what stage each moment shows,
 * what work is visible, and what the walkthrough never covered.
 *
 * The stage vocabulary is not the model's to invent. Stages are the capture
 * guide's own steps, passed in by index, and the model may only answer with an
 * index or with "unclear". A narration that invents stages would drift from
 * the instructions the crew was actually given, and the report's whole value
 * is that the two line up.
 *
 * Same honesty contract as the proof analyst: describe only what is visible,
 * prefer unclear to a guess, and parse hard — a malformed reply becomes null,
 * and null means "not narrated", which is honest.
 */

export interface StageStep {
  /** The guide step's instruction, shortened for the prompt. */
  label: string;
  kind: 'anchor' | 'scope' | 'exclusion' | 'wrap';
}

/* ------------------------------------------------------------------ *
 * Live observation — one frame, right now
 * ------------------------------------------------------------------ */

export interface LiveObservation {
  /** Index into the provided steps, or -1 for unclear. */
  stageIndex: number;
  note: string;
  confidence: number;
}

const OBSERVE_SYSTEM = `You are watching a single frame from a video being filmed right now on a job site, against a numbered shot list.

Rules:
1. Answer with the number of the shot-list stage this frame most plausibly belongs to, or -1 if you cannot tell. Prefer -1 over a guess.
2. The note is one short sentence about what is visible. Only what is visible — never what is probably happening off screen.
3. Confidence is between 0 and 1 and should be honest; 0.3 for a plausible guess is more useful than 0.9 for one.

Reply with JSON only: {"stage": number, "note": string, "confidence": number}`;

export function parseObservation(text: string, stepCount: number): LiveObservation | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (typeof parsed.note !== 'string' || !parsed.note.trim()) return null;

  // A stage outside the list is a stage that does not exist: unclear, not an
  // invention.
  let stageIndex = Number.isInteger(parsed.stage) ? parsed.stage : -1;
  if (stageIndex < -1 || stageIndex >= stepCount) stageIndex = -1;

  const confidence =
    typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0;

  return { stageIndex, note: parsed.note.trim().slice(0, 300), confidence };
}

export async function observeLiveFrame(input: {
  frameBase64: string;
  steps: StageStep[];
  lastStageIndex?: number | null;
}): Promise<LiveObservation | null> {
  if (!isModelProviderConfigured()) return null;
  if (!input.steps.length) return null;

  const list = input.steps.map((s, i) => `${i}. [${s.kind}] ${s.label}`).join('\n');
  const response = await anthropicClient().messages.create({
    model: config.technician.assistant.model,
    max_tokens: 200,
    system: OBSERVE_SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              `The shot list:\n${list}\n` +
              (input.lastStageIndex !== null && input.lastStageIndex !== undefined
                ? `The previous frame was judged stage ${input.lastStageIndex}. Stages usually run in order, but do not force it.\n`
                : '') +
              'The current frame:',
          },
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: input.frameBase64 },
          },
        ],
      },
    ],
  });

  const text = response.content.find((b) => b.type === 'text');
  return text && text.type === 'text' ? parseObservation(text.text, input.steps.length) : null;
}

/* ------------------------------------------------------------------ *
 * Narration — the report attached to one video
 * ------------------------------------------------------------------ */

export interface NarrationEntry {
  /** Index into the frames given, so the entry stays attached to a moment. */
  frame: number;
  atSeconds: number;
  /** Index into the guide steps, or -1 for a moment that matches none. */
  stageIndex: number;
  note: string;
}

export interface VideoNarration {
  entries: NarrationEntry[];
  /** Which guide steps the footage actually covered. Computed, not claimed. */
  coverage: Array<{ stageIndex: number; label: string; seen: boolean }>;
  /** The report: a few sentences of what the video shows, start to finish. */
  report: string;
  model: string | null;
}

const NARRATE_SYSTEM = `You are reading frames, in order, from one video filmed on a job site against a numbered shot list.

Your output becomes the written report attached to this video. Rules:
1. For each frame, say which shot-list stage it most plausibly shows (-1 if you cannot tell), and one sentence of what is visible in it.
2. The report is 2-4 sentences narrating the video start to finish: where it opens, what work state it shows, where it ends. Only what the frames show.
3. Never state or imply that work was completed unless a frame shows the completed state.
4. Prefer -1 and plain uncertainty over a guess. An honest "the middle of the clip never shows the work area" is more valuable than an invented tour.

Reply with JSON only:
{"entries": [{"frame": number, "stage": number, "note": string}], "report": string}`;

export function parseNarration(
  text: string,
  frames: Array<{ atSeconds: number }>,
  steps: StageStep[],
): Omit<VideoNarration, 'model'> | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (typeof parsed.report !== 'string' || !parsed.report.trim()) return null;

  const entries: NarrationEntry[] = Array.isArray(parsed.entries)
    ? parsed.entries
        .filter(
          (e: any) =>
            e &&
            Number.isInteger(e.frame) &&
            e.frame >= 0 &&
            e.frame < frames.length &&
            typeof e.note === 'string' &&
            e.note.trim(),
        )
        .map((e: any) => ({
          frame: e.frame,
          atSeconds: frames[e.frame].atSeconds,
          stageIndex:
            Number.isInteger(e.stage) && e.stage >= 0 && e.stage < steps.length ? e.stage : -1,
          note: String(e.note).trim().slice(0, 300),
        }))
        .slice(0, 24)
    : [];

  // An empty entries list with a confident report is the shape of a made-up
  // narration; refuse it whole rather than storing prose with no grounding.
  if (entries.length === 0) return null;

  // Coverage is computed from the grounded entries, never taken from the
  // model: "which steps were seen" is arithmetic once the entries exist, and
  // arithmetic does not hallucinate.
  const seen = new Set(entries.map((e) => e.stageIndex).filter((i) => i >= 0));
  const coverage = steps.map((step, i) => ({ stageIndex: i, label: step.label, seen: seen.has(i) }));

  return { entries, coverage, report: parsed.report.trim().slice(0, 2000) };
}

export async function narrateProofVideo(input: {
  frames: Array<{ atSeconds: number; base64: string }>;
  steps: StageStep[];
  scopeTitles: string[];
  phase: 'before' | 'after' | string;
  workDate: string;
}): Promise<VideoNarration | null> {
  if (!isModelProviderConfigured()) return null;
  if (!input.frames.length || !input.steps.length) return null;

  const list = input.steps.map((s, i) => `${i}. [${s.kind}] ${s.label}`).join('\n');
  const scope = input.scopeTitles.length
    ? input.scopeTitles.map((t) => `- ${t}`).join('\n')
    : '(no scope recorded)';

  const response = await anthropicClient().messages.create({
    model: config.technician.assistant.model,
    max_tokens: 900,
    system: NARRATE_SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              `A ${input.phase} video filmed ${input.workDate}.\n` +
              `The shot list the crew was given:\n${list}\n` +
              `The scope of work on this job:\n${scope}\n` +
              `The frames, in order (frame index precedes each):`,
          },
          ...input.frames.flatMap((frame, i) => [
            { type: 'text' as const, text: `frame ${i} — at ${Math.round(frame.atSeconds)}s:` },
            {
              type: 'image' as const,
              source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: frame.base64 },
            },
          ]),
        ],
      },
    ],
  });

  const text = response.content.find((b) => b.type === 'text');
  const parsed =
    text && text.type === 'text' ? parseNarration(text.text, input.frames, input.steps) : null;
  return parsed ? { ...parsed, model: response.model } : null;
}

/** The guide steps, shortened into the stage vocabulary the prompts use. */
export function stepsForNarration(
  guideSteps: Array<{ kind: 'anchor' | 'scope' | 'exclusion' | 'wrap'; instruction: string }>,
): StageStep[] {
  return guideSteps.map((step) => ({
    kind: step.kind,
    // The first sentence carries the stage's identity; the rest is coaching.
    label: step.instruction.split(/[.!]/)[0].slice(0, 120),
  }));
}
