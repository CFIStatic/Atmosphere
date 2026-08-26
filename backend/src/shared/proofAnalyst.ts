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

/**
 * Did the work area visibly change between the two videos?
 *
 * The verdict the general contractor actually opens the page for, stated
 * rather than left implied by the summary. 'none' is not a failure mode — "you
 * claimed a day and the footage shows nothing changed" is exactly the sentence
 * this feature exists to produce. 'unclear' is for footage that does not allow
 * the comparison, which is a different claim from "nothing changed" and must
 * never collapse into it.
 */
export type MaterialChange = 'significant' | 'minor' | 'none' | 'unclear';

/**
 * Where a clip's opening frames put the camera. Crews are told to start
 * outside facing the building (see captureGuide.ts) because an exterior
 * opening anchors the location and identity checks; this is the model saying
 * whether they actually did. 'unclear' is the honest default and never counts
 * against anyone — 'not_exterior' is the only word that says the instruction
 * was skipped.
 */
export type OpeningWord = 'exterior' | 'not_exterior' | 'unclear';

export interface ProofAnalysis {
  /** Two or three sentences a project manager can read at a glance. */
  summary: string;
  materialChange: MaterialChange;
  /** What in the frames supports the verdict, so it can be checked. */
  materialBecause: string;
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
  /** Whether each clip opens at the property exterior, as instructed. */
  opening: { before: OpeningWord; after: OpeningWord };
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
8. State whether the work area materially changed between the two videos. Use "significant" only when the after frames show the area in a clearly different state AND you have listed those differences under changes. Use "minor" for small visible differences. Use "none" when the frames look substantially the same — say it plainly; it is an important answer, not a failure. Use "unclear" when lighting, framing or coverage make the comparison unreliable. Never infer change from hours elapsed, from the scope, or from what a trade would normally have done.
9. For each video separately, judge only its FIRST frame: does it open at the exterior of the property — building front, yard, driveway, street approach? Use "exterior" only when the first frame is clearly outdoors at a building. Use "not_exterior" when it is clearly indoors or of something else entirely. Use "unclear" whenever you cannot tell, and prefer it — this is a note about filming habit, not an accusation, and a guess is worse than no answer.

Reply with JSON only, no prose around it:
{"summary": string, "materialChange": "significant" | "minor" | "none" | "unclear", "materialBecause": string, "changes": string[], "cannotTell": string[], "scopeTouched": string[], "scopeVerdicts": [{"title": string, "verdict": "appears_complete" | "in_progress" | "not_visible", "because": string}], "concerns": string[], "opening": {"before": "exterior" | "not_exterior" | "unclear", "after": "exterior" | "not_exterior" | "unclear"}}`;

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

  const changes = list(parsed.changes);

  // The verdict is only as good as its grounding. A "significant" with an
  // empty changes list is a claim with nothing behind it — and it is the exact
  // shape of output that releases a payment for work the frames do not show.
  // Downgraded to 'unclear' rather than discarded, because the summary and the
  // scope verdicts may still be sound.
  const changeWords = new Set<MaterialChange>(['significant', 'minor', 'none', 'unclear']);
  let materialChange: MaterialChange = changeWords.has(parsed.materialChange)
    ? parsed.materialChange
    : 'unclear';
  let materialBecause =
    typeof parsed.materialBecause === 'string' ? parsed.materialBecause.trim().slice(0, 500) : '';
  if ((materialChange === 'significant' || materialChange === 'minor') && changes.length === 0) {
    materialChange = 'unclear';
    materialBecause = 'The analysis claimed a change but cited nothing visible to support it.';
  }
  if (!materialBecause && materialChange === 'unclear') {
    materialBecause = 'The analysis did not say whether the work area changed.';
  }

  // The opening judgement defaults to 'unclear' on anything malformed: an
  // absent or invented word must never read as either compliance or a skip.
  const openingWords = new Set<OpeningWord>(['exterior', 'not_exterior', 'unclear']);
  const openingWord = (value: unknown): OpeningWord =>
    typeof value === 'string' && openingWords.has(value as OpeningWord)
      ? (value as OpeningWord)
      : 'unclear';

  return {
    summary: parsed.summary.trim().slice(0, 2000),
    materialChange,
    materialBecause,
    changes,
    cannotTell: list(parsed.cannotTell),
    scopeTouched: list(parsed.scopeTouched),
    scopeVerdicts,
    concerns: list(parsed.concerns),
    opening: {
      before: openingWord(parsed.opening?.before),
      after: openingWord(parsed.opening?.after),
    },
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
export interface DayFilmAnalysis {
  summary: string;
  workPerformed: string[];
  cannotTell: string[];
  scopeTouched: string[];
  scopeVerdicts: ScopeVerdict[];
  concerns: string[];
  opening: OpeningWord;
  model: string | null;
}

const DAY_FILM_SYSTEM = `You are looking at frames from one video of a work day on a construction or restoration job (the crew films the day — there is not always a separate before clip).

The office dashboard will show your answer as "what work was performed." Accuracy matters more than usefulness. Follow these rules exactly:

1. Describe only what is visible in the frames. Never infer what was probably done off-camera, what a trade normally does next, or what the scope implies should have happened.
2. Under workPerformed, list concrete activities you can see (materials, tools, rooms, trades). An empty list is fine if the frames do not show work.
3. If lighting, angle, or framing make the work unclear, say that in cannotTell rather than guessing.
4. Only list a scope line under scopeTouched if the frames actually show work on it.
5. Give a verdict for every scope line you are shown, using its exact title. Use "appears_complete" only when the frames show the finished state of that line. Use "in_progress" when work on it is visible but unfinished. Use "not_visible" when the frames simply do not cover it. Never invent scope lines.
6. Under concerns, note anything visible that looks like damage, a hazard, or work outside the listed scope. Nothing else.
7. Never mention money, hours, or whether the work seems worth paying for.
8. Judge only the FIRST frame: does it open at the exterior of the property? Use "exterior", "not_exterior", or "unclear". Prefer "unclear".

Reply with JSON only, no prose around it:
{"summary": string, "workPerformed": string[], "cannotTell": string[], "scopeTouched": string[], "scopeVerdicts": [{"title": string, "verdict": "appears_complete" | "in_progress" | "not_visible", "because": string}], "concerns": string[], "opening": "exterior" | "not_exterior" | "unclear"}`;

export function parseDayFilmAnalysis(text: string): Omit<DayFilmAnalysis, 'model'> | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let raw: any;
  try {
    raw = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.summary !== 'string' || !raw.summary.trim()) return null;

  const list = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).slice(0, 12)
      : [];

  const allowed = new Set(['appears_complete', 'in_progress', 'not_visible']);
  const scopeVerdicts: ScopeVerdict[] = Array.isArray(raw.scopeVerdicts)
    ? raw.scopeVerdicts
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

  const openingWords = new Set<OpeningWord>(['exterior', 'not_exterior', 'unclear']);
  const opening: OpeningWord =
    typeof raw.opening === 'string' && openingWords.has(raw.opening as OpeningWord)
      ? (raw.opening as OpeningWord)
      : 'unclear';

  const workPerformed = list(raw.workPerformed);
  return {
    summary: raw.summary.trim().slice(0, 2000),
    workPerformed,
    cannotTell: list(raw.cannotTell),
    scopeTouched: list(raw.scopeTouched),
    scopeVerdicts,
    concerns: list(raw.concerns),
    opening,
  };
}

/**
 * What the day film shows — used when Field Capture files one clip for the day
 * instead of a before/after pair.
 */
export async function analyseDayFilm(input: {
  frames: ProofFrame[];
  scopeTitles: string[];
  workDate: string;
  trade?: string | null;
}): Promise<DayFilmAnalysis | null> {
  if (!isModelProviderConfigured()) return null;
  if (!input.frames.length) return null;

  const scopeBlock = input.scopeTitles.length
    ? `Agreed work to look for — give a verdict for every line using its exact title:\n${input.scopeTitles.map((t) => `- ${t}`).join('\n')}`
    : [
        'No written work description is attached.',
        'Describe what the worker is doing from the frames.',
        'Leave scopeTouched and scopeVerdicts empty — do not invent scope lines.',
      ].join(' ');

  const response = await anthropicClient().messages.create({
    model: config.technician.assistant.model,
    max_tokens: 1200,
    system: DAY_FILM_SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              `Work date: ${input.workDate}\n` +
              (input.trade ? `Trade: ${input.trade}\n` : '') +
              `\n${scopeBlock}\n`,
          },
          ...imageBlocks(input.frames, 'DAY FILM'),
        ],
      },
    ],
  });

  const text = response.content
    .filter((block: any) => block.type === 'text')
    .map((block: any) => block.text)
    .join('\n');

  const parsed = parseDayFilmAnalysis(text);
  if (!parsed) return null;
  return {
    ...parsed,
    scopeVerdicts: keepKnownScope(parsed.scopeVerdicts, input.scopeTitles),
    model: response.model,
  };
}

export async function analyseProofDay(input: {
  beforeFrames: ProofFrame[];
  afterFrames: ProofFrame[];
  scopeTitles: string[];
  workDate: string;
  trade?: string | null;
}): Promise<ProofAnalysis | null> {
  if (!isModelProviderConfigured()) return null;
  if (!input.beforeFrames.length || !input.afterFrames.length) return null;

  const scopeBlock = input.scopeTitles.length
    ? `Agreed scope lines — cross-reference what is visible; give a verdict for every line using its exact title:\n${input.scopeTitles.map((t) => `- ${t}`).join('\n')}`
    : [
        'No scope is attached for this party.',
        'Describe what the worker is doing from the frames and whether the work area changed between before and after.',
        'Leave scopeTouched and scopeVerdicts empty — do not invent scope lines.',
      ].join(' ');

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
              `\n${scopeBlock}\n`,
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

const QA_SYSTEM = `You answer a project manager's questions about a job's filed videos, using only the analyses provided.

Rules:
1. Answer only from the record given. It is what the assistant already saw in the frames and, when present, heard on the mic.
2. If the record does not contain the answer, say "The videos on file do not show that" and stop. Do not reason about what was probably true.
3. Quote the work date and which clip (before / after / day film) when you cite something, so the answer can be checked.
4. Two or three sentences. This is read on a phone between site visits.
5. Never estimate cost, hours, or whether work was worth paying for.`;

export interface CollectionClip {
  workDate: string;
  phase?: string | null;
  company?: string | null;
  summary?: string | null;
  narration?: string | null;
  transcript?: string | null;
  changes?: string[];
  concerns?: string[];
}

function clipLabel(clip: CollectionClip): string {
  const phase =
    clip.phase === 'before' ? 'morning clip' : clip.phase === 'after' ? 'day film' : clip.phase || 'clip';
  return `${clip.workDate} (${phase}${clip.company ? `, ${clip.company}` : ''})`;
}

export function formatCollectionRecord(clips: CollectionClip[]): string {
  return clips
    .map((clip) => {
      const lines = [clipLabel(clip)];
      if (clip.summary) lines.push(`  Seen: ${clip.summary}`);
      if (clip.narration && clip.narration !== clip.summary) lines.push(`  Narration: ${clip.narration}`);
      if (clip.transcript) lines.push(`  Heard on the mic: ${clip.transcript.slice(0, 1200)}`);
      if (clip.changes?.length) lines.push(`  Changes: ${clip.changes.join('; ')}`);
      if (clip.concerns?.length) lines.push(`  Concerns: ${clip.concerns.join('; ')}`);
      return lines.join('\n');
    })
    .join('\n\n');
}

/** Every filed clip on a job — morning, day film, and leftover phases alike. */
export function collectionClipsFromRows(
  rows: Array<{
    work_date?: string;
    workDate?: string;
    phase?: string | null;
    company?: string | null;
    ai_summary?: string | null;
    narration_text?: string | null;
    transcript_text?: string | null;
    ai_findings?: {
      changes?: unknown;
      workPerformed?: unknown;
      concerns?: unknown;
    } | null;
  }>,
): CollectionClip[] {
  const asStrings = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];

  return rows.map((row) => ({
    workDate: String(row.work_date ?? row.workDate ?? ''),
    phase: row.phase ?? null,
    company: row.company ?? null,
    summary: row.ai_summary ?? row.narration_text ?? null,
    narration: row.narration_text ?? null,
    transcript: row.transcript_text ?? null,
    changes: asStrings(row.ai_findings?.changes ?? row.ai_findings?.workPerformed),
    concerns: asStrings(row.ai_findings?.concerns),
  }));
}

const STOP = new Set([
  'the', 'a', 'an', 'in', 'on', 'of', 'to', 'and', 'or', 'did', 'does', 'do', 'is', 'was',
  'are', 'were', 'this', 'that', 'it', 'any', 'what', 'when', 'where', 'how', 'who', 'why',
  'video', 'videos', 'clip', 'film', 'day',
]);

/** Keyword lookup so Ask still answers when no model key is configured. */
export function groundedCollectionAnswer(question: string, clips: CollectionClip[]): string {
  if (!clips.length) return 'Nothing has been filed for this job yet, so there is nothing to answer from.';
  const words = question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
  const hits = clips.filter((clip) => {
    const hay = [clip.summary, clip.narration, clip.transcript, ...(clip.changes ?? []), ...(clip.concerns ?? [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return words.length === 0 || words.some((w) => hay.includes(w));
  });
  const use = hits.length ? hits : clips;
  const first = use[0]!;
  const text = first.summary || first.narration || first.transcript || 'The footage is on file.';
  return `${clipLabel(first)}: ${text}`.slice(0, 600);
}

/**
 * Answer a question from the analyses already on file — frames and, when
 * present, the mic. Grounded in what was already written, not a second watch.
 */
export async function answerFromProofs(input: {
  question: string;
  days?: Array<{ workDate: string; summary: string; changes: string[]; concerns: string[] }>;
  clips?: CollectionClip[];
}): Promise<{ answer: string; model: string | null } | null> {
  const clips: CollectionClip[] =
    input.clips ??
    (input.days ?? []).map((day) => ({
      workDate: day.workDate,
      summary: day.summary,
      changes: day.changes,
      concerns: day.concerns,
    }));

  if (!clips.length) {
    return {
      answer: 'Nothing has been filed for this job yet, so there is nothing to answer from.',
      model: null,
    };
  }

  if (!isModelProviderConfigured()) {
    return { answer: groundedCollectionAnswer(input.question, clips), model: null };
  }

  const record = formatCollectionRecord(clips);
  const response = await anthropicClient().messages.create({
    model: config.technician.assistant.model,
    max_tokens: 500,
    system: QA_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Video collection for this job:\n\n${record}\n\nQuestion: ${input.question}`,
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
