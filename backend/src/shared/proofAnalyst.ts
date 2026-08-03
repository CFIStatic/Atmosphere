import { anthropicClient, isModelProviderConfigured } from '../lib/anthropic.js';
import { config } from '../config.js';

/**
 * Reading the proof videos, and answering questions about them.
 *
 * A project manager has forty jobs and cannot watch eighty videos a day. So the
 * model watches — via frames the phone extracts on upload, because a stack of
 * stills is what a vision model can actually read and it is a fraction of the
 * bytes.
 *
 * The whole difficulty is that this output can move money. A summary that says
 * "drywall hung in the master bedroom" when the frames show an empty room is
 * not a bad summary, it is a false invoice with a machine's name on it. So the
 * instructions below are built around one rule, stated three ways because it is
 * the only thing that matters here:
 *
 *   Describe what is visible. Do not infer what was probably done. If the
 *   before and after look the same, say they look the same.
 *
 * The second rule follows from the first: the model is never told the amount,
 * the invoice, or whether the sub is trusted. Nothing about the money reaches
 * it, so nothing about the money can bias what it claims to see. It gets the
 * scope, because "was this in scope" is the useful question, and it gets the
 * frames. That is all.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ProofFrame {
  /** Seconds into the clip. Ordering matters more than exactness. */
  atSeconds: number;
  /** Base64 JPEG, extracted on the device. */
  base64: string;
}

/**
 * What the footage says about one scope line.
 *
 * Three verdicts, and the third is the one that keeps this honest. A camera
 * that never pointed at the bathroom says nothing about the bathroom, and
 * `not_visible` is the difference between "we did not see it done" and "it was
 * not done" — a distinction somebody withholding a payment has to be able to
 * make.
 */
export interface ScopeVerdict {
  title: string;
  verdict: 'appears_complete' | 'in_progress' | 'not_visible';
  /** What in the frames led to that, so it can be checked rather than trusted. */
  because: string;
}

export interface ProofAnalysis {
  /** Two or three sentences a project manager can read at a glance. */
  summary: string;
  /** Concrete, visible differences between before and after. */
  changes: string[];
  /** Things the frames genuinely do not settle. Empty is suspicious, not good. */
  cannotTell: string[];
  /** Scope lines the footage appears to touch, by title. Never invented. */
  scopeTouched: string[];
  /** Per scope line, what the footage supports. */
  scopeVerdicts: ScopeVerdict[];
  /** Anything visible that looks like work nobody asked for. */
  concerns: string[];
  model: string | null;
}

const SYSTEM = `You are looking at frames from two videos of the same building: one filmed before a subcontractor's work for the day, one after.

Your output is read by a project manager deciding whether to pay for that day. That makes accuracy more important than usefulness. Follow these rules exactly:

1. Describe only what is visible in the frames. Never infer what was probably done, what a trade normally does next, or what the scope implies should have happened.
2. If the before and after frames look substantially the same, say so plainly. "No visible change between the two" is a valid and important answer.
3. If lighting, angle or framing make a comparison unreliable, say that in cannotTell rather than guessing.
4. Only list a scope line under scopeTouched if the frames actually show work on it. An empty list is fine.
5. Under concerns, note anything visible that looks like damage, a hazard, or work outside the listed scope. Nothing else.
6. Never mention money, hours, or whether the work seems worth paying for. You are not being asked.
7. Give a verdict for every scope line you are shown, using its exact title. Use "appears_complete" only when the after frames show the finished state of that line. Use "in_progress" when work on it is visible but unfinished. Use "not_visible" when the frames simply do not cover it — that is the correct answer far more often than the other two, and choosing it costs nothing. Never mark a line complete because the other lines are.

Reply with JSON only, no prose around it:
{"summary": string, "changes": string[], "cannotTell": string[], "scopeTouched": string[], "scopeVerdicts": [{"title": string, "verdict": "appears_complete" | "in_progress" | "not_visible", "because": string}], "concerns": string[]}`;

/** Frames get expensive fast; this is enough to see a room change. */
const MAX_FRAMES_PER_VIDEO = 6;

function pickFrames(frames: ProofFrame[]): ProofFrame[] {
  if (frames.length <= MAX_FRAMES_PER_VIDEO) return frames;
  // Evenly spaced across the clip rather than the first N — the first six
  // frames of a walkthrough are all the front door.
  const step = (frames.length - 1) / (MAX_FRAMES_PER_VIDEO - 1);
  return Array.from({ length: MAX_FRAMES_PER_VIDEO }, (_, i) => frames[Math.round(i * step)]);
}

function imageBlocks(frames: ProofFrame[], label: string) {
  return [
    { type: 'text' as const, text: `--- ${label} (${frames.length} frames) ---` },
    ...pickFrames(frames).map((frame) => ({
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: frame.base64 },
    })),
  ];
}

/**
 * Parse the model's reply, refusing anything that is not the shape asked for.
 *
 * Exported for testing, and tested hard, because the failure that matters is
 * not a crash — it is a malformed reply half-parsed into a summary that reads
 * authoritative and says nothing true.
 */
export function parseAnalysis(text: string): Omit<ProofAnalysis, 'model'> | null {
  // The model is told to reply with JSON only; a fenced block is the common
  // near-miss and is worth accepting rather than discarding a good answer.
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (typeof parsed.summary !== 'string' || !parsed.summary.trim()) return null;

  const list = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).slice(0, 12)
      : [];

  // Verdicts are validated hard. A completion claim on a line nobody asked
  // about, or with an invented verdict word, is exactly the kind of confident
  // nonsense that gets a payment released.
  const allowed = new Set(['appears_complete', 'in_progress', 'not_visible']);
  const scopeVerdicts: ScopeVerdict[] = Array.isArray(parsed.scopeVerdicts)
    ? parsed.scopeVerdicts
        .filter(
          (v: any) =>
            v &&
            typeof v.title === 'string' &&
            v.title.trim() &&
            typeof v.verdict === 'string' &&
            allowed.has(v.verdict),
        )
        .map((v: any) => ({
          title: String(v.title).trim().slice(0, 200),
          verdict: v.verdict as ScopeVerdict['verdict'],
          because: typeof v.because === 'string' ? v.because.trim().slice(0, 500) : '',
        }))
        .slice(0, 20)
    : [];

  return {
    summary: parsed.summary.trim().slice(0, 2000),
    changes: list(parsed.changes),
    cannotTell: list(parsed.cannotTell),
    scopeTouched: list(parsed.scopeTouched),
    scopeVerdicts,
    concerns: list(parsed.concerns),
  };
}

/**
 * Drop verdicts about lines that are not in the scope.
 *
 * A model asked to judge six lines will occasionally return a seventh it
 * invented, and a completion claim against work nobody ordered is worse than
 * no claim at all. Matched case-insensitively on the trimmed title, because
 * exact-match on a title somebody typed is a coin flip.
 */
export function keepKnownScope(
  verdicts: ScopeVerdict[],
  scopeTitles: string[],
): ScopeVerdict[] {
  const known = new Map(scopeTitles.map((t) => [t.trim().toLowerCase(), t]));
  const seen = new Set<string>();
  const out: ScopeVerdict[] = [];
  for (const verdict of verdicts) {
    const key = verdict.title.trim().toLowerCase();
    const real = known.get(key);
    if (!real || seen.has(key)) continue;
    seen.add(key);
    // The stored title wins, so the dashboard can match it to the scope row.
    out.push({ ...verdict, title: real });
  }
  return out;
}

/**
 * What changed between the two videos.
 *
 * Returns null rather than a guess when the model is unavailable or the reply
 * is unusable. A day with no analysis reads as "not analysed", which is honest;
 * a day with a fabricated analysis reads as evidence.
 */
export async function analyseProofDay(input: {
  beforeFrames: ProofFrame[];
  afterFrames: ProofFrame[];
  scopeTitles: string[];
  workDate: string;
  trade?: string | null;
}): Promise<ProofAnalysis | null> {
  if (!isModelProviderConfigured()) return null;
  if (!input.beforeFrames.length || !input.afterFrames.length) return null;

  const scope = input.scopeTitles.length
    ? input.scopeTitles.map((t) => `- ${t}`).join('\n')
    : '(no scope recorded for this party)';

  const response = await anthropicClient().messages.create({
    model: config.technician.assistant.model,
    max_tokens: 1200,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              `Work date: ${input.workDate}\n` +
              (input.trade ? `Trade: ${input.trade}\n` : '') +
              `\nScope lines on file for this party:\n${scope}\n`,
          },
          ...imageBlocks(input.beforeFrames, 'BEFORE'),
          ...imageBlocks(input.afterFrames, 'AFTER'),
        ],
      },
    ],
  });

  const text = response.content
    .filter((block: any) => block.type === 'text')
    .map((block: any) => block.text)
    .join('\n');

  const parsed = parseAnalysis(text);
  if (!parsed) return null;
  return {
    ...parsed,
    scopeVerdicts: keepKnownScope(parsed.scopeVerdicts, input.scopeTitles),
    model: response.model,
  };
}

const QA_SYSTEM = `You answer a project manager's questions about a subcontractor's daily proof-of-work videos, using only the analyses provided.

Rules:
1. Answer only from the analyses given. They are descriptions of video frames somebody already looked at.
2. If the analyses do not contain the answer, say "The videos on file do not show that" and stop. Do not reason about what was probably true.
3. Quote the work date when you cite something, so the answer can be checked.
4. Two or three sentences. This is read on a phone between site visits.
5. Never estimate cost, hours, or whether work was worth paying for.`;

/**
 * Answer a question from the analyses already on file.
 *
 * Grounded in the summaries rather than re-reading the video, which is both
 * cheaper and better: the summaries were produced under the "describe only what
 * is visible" rule, so an answer built from them inherits that discipline
 * instead of inviting a fresh round of inference.
 */
export async function answerFromProofs(input: {
  question: string;
  days: Array<{ workDate: string; summary: string; changes: string[]; concerns: string[] }>;
}): Promise<{ answer: string; model: string | null } | null> {
  if (!isModelProviderConfigured()) return null;
  if (!input.days.length) {
    return {
      answer: 'Nothing has been filed for this job yet, so there is nothing to answer from.',
      model: null,
    };
  }

  const record = input.days
    .map(
      (day) =>
        `${day.workDate}: ${day.summary}` +
        (day.changes.length ? `\n  Changes: ${day.changes.join('; ')}` : '') +
        (day.concerns.length ? `\n  Concerns: ${day.concerns.join('; ')}` : ''),
    )
    .join('\n\n');

  const response = await anthropicClient().messages.create({
    model: config.technician.assistant.model,
    max_tokens: 500,
    system: QA_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Proof-of-work record for this job:\n\n${record}\n\nQuestion: ${input.question}`,
      },
    ],
  });

  const answer = response.content
    .filter((block: any) => block.type === 'text')
    .map((block: any) => block.text)
    .join('\n')
    .trim();

  return answer ? { answer, model: response.model } : null;
}
