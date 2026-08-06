import { anthropicClient } from '../lib/anthropic.js';
import { config } from '../config.js';

/**
 * Reading a workday, not a walkthrough.
 *
 * The guided clips the product is built around run a minute or five. But a
 * crew can also record the day itself — two, three, seven hours — and the
 * question does not change: against the scope both sides agreed to, what was
 * done? The answer has to stay honest at that length, which is what this
 * module is for.
 *
 * The shape is hierarchical, because seven hours does not fit in one look:
 *
 *   1. The recording's sampled frames are grouped into TIME WINDOWS
 *      (segmentFrames — pure arithmetic, testable).
 *   2. The cheap model reads each window and reports only what that window
 *      shows: which scope lines are being worked, what activity is visible,
 *      what it could not tell. Closed references — a window can only cite a
 *      scope line by its index, and an invented index is dropped in the
 *      parser, not negotiated with.
 *   3. A mid-tier model synthesizes the day from the window readings, and
 *      writes the per-line verdicts and the narrative. It sees no pixels —
 *      only the summaries step 2 already wrote — so the flagship's judgment
 *      buys nothing here, and the caps below are applied in code anyway.
 *
 * The cost shape follows from that split. A seven-hour day is ~250 frames at
 * 900 px, so the frame leg dominates and belongs on the cheapest tier that
 * can do a closed-vocabulary read; the synthesis is one text-only call.
 *
 * Two computed-not-claimed rules keep the report honest. A line's verdict may
 * never be stronger than its sightings: if no window saw line 3 worked, the
 * synthesis cannot call line 3 complete — the parser downgrades it to
 * not_visible no matter what the model wrote. And coverage ("seen in 14 of
 * 21 windows, hours 2-5") is arithmetic over the stored window rows, never a
 * sentence the model composed.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface FrameRef {
  atSeconds: number;
}

export interface Window {
  idx: number;
  startSeconds: number;
  endSeconds: number;
  /** Indexes into the frames array handed to segmentFrames. */
  frameIdxs: number[];
}

/**
 * Group sampled frames into read-windows. Pure: same frames, same windows.
 * Windows close when they reach maxFrames or span more than maxSeconds —
 * whichever first — so a sparse recording still yields sane spans.
 */
export function segmentFrames(
  frames: FrameRef[],
  opts?: { maxFrames?: number; maxSeconds?: number },
): Window[] {
  const maxFrames = opts?.maxFrames ?? 12;
  const maxSeconds = opts?.maxSeconds ?? 1200;
  const sorted = frames
    .map((f, i) => ({ at: f.atSeconds, i }))
    .sort((a, b) => a.at - b.at);

  const windows: Window[] = [];
  let start = 0;
  let lastAt = 0;
  let idxs: number[] = [];
  const flush = () => {
    if (idxs.length) {
      windows.push({ idx: windows.length, startSeconds: start, endSeconds: lastAt, frameIdxs: idxs });
    }
    idxs = [];
  };
  for (const frame of sorted) {
    if (idxs.length && (idxs.length >= maxFrames || frame.at - start > maxSeconds)) flush();
    if (!idxs.length) start = frame.at;
    idxs.push(frame.i);
    lastAt = frame.at;
  }
  flush();
  return windows;
}

export interface WindowReading {
  /** One sentence: what this stretch of the day shows. */
  summary: string;
  /** Scope-line indexes visibly being worked in this window. */
  scopeTouched: number[];
  /** Free-line activity words for the index (demo, drying, cleanup...). */
  activity: string[];
  couldNotTell: string[];
}

export function windowPrompt(scopeTitles: string[]): string {
  return [
    'You are reading frames from one time window of a long job-site recording. Report ONLY what these frames show — other windows cover the rest of the day.',
    '',
    'The agreed scope lines, cited by index:',
    ...scopeTitles.map((t, i) => `  ${i}: ${t}`),
    '',
    'Return STRICT JSON only:',
    '{"summary": "one sentence", "scopeTouched": [0, 2], "activity": ["demolition"], "couldNotTell": ["..."]}',
    '',
    'Rules:',
    '1. scopeTouched may contain ONLY indexes from the list above, and only for work VISIBLY underway or completed in these frames. Seeing the area is not touching the line.',
    '2. If the frames are too dark, blocked, or ambiguous, say so in couldNotTell and keep scopeTouched empty. "Could not tell" is a correct answer.',
    '3. activity: at most 4 lower-case words or short phrases for what is happening (e.g. "drying equipment running", "cleanup").',
    '4. Never mention a scope line in the summary that is not in scopeTouched.',
  ].join('\n');
}

export function parseWindowReading(raw: string, scopeCount: number): WindowReading | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof parsed?.summary !== 'string' || !parsed.summary.trim()) return null;
  return {
    summary: parsed.summary.trim().slice(0, 300),
    // The closed vocabulary: an index outside the scope list was invented,
    // and invented citations do not survive the parser.
    scopeTouched: Array.isArray(parsed.scopeTouched)
      ? [...new Set(parsed.scopeTouched.filter((n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < scopeCount))] as number[]
      : [],
    activity: Array.isArray(parsed.activity)
      ? parsed.activity.filter((s: unknown) => typeof s === 'string' && (s as string).trim()).map((s: string) => s.trim().toLowerCase().slice(0, 40)).slice(0, 4)
      : [],
    couldNotTell: Array.isArray(parsed.couldNotTell)
      ? parsed.couldNotTell.filter((s: unknown) => typeof s === 'string' && (s as string).trim()).map((s: string) => s.trim().slice(0, 200)).slice(0, 5)
      : [],
  };
}

/** Which windows saw each scope line worked. Arithmetic, not testimony. */
export function scopeSightings(
  readings: Array<{ idx: number; reading: WindowReading | null }>,
  scopeCount: number,
): number[][] {
  const sightings: number[][] = Array.from({ length: scopeCount }, () => []);
  for (const { idx, reading } of readings) {
    if (!reading) continue;
    for (const line of reading.scopeTouched) {
      if (line >= 0 && line < scopeCount) sightings[line].push(idx);
    }
  }
  return sightings;
}

export type LineVerdict = 'appears_complete' | 'in_progress' | 'not_visible';

export interface DayReport {
  /** Per scope line, aligned by index. */
  verdicts: Array<{
    title: string;
    verdict: LineVerdict;
    because: string;
    /** Window indexes where this line was seen worked — computed. */
    seenInWindows: number[];
  }>;
  narrative: string;
  couldNotTell: string[];
  model: string;
}

export function synthesisPrompt(input: {
  scopeTitles: string[];
  totalHours: string;
  windows: Array<{ idx: number; startSeconds: number; endSeconds: number; reading: WindowReading | null }>;
}): string {
  const hhmm = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h + ':' + String(m).padStart(2, '0');
  };
  return [
    `You are writing the day's verification report for a ${input.totalHours}-hour job-site recording, from window-by-window readings made by another pass over the actual frames.`,
    '',
    'The agreed scope lines, cited by index:',
    ...input.scopeTitles.map((t, i) => `  ${i}: ${t}`),
    '',
    'The window readings:',
    ...input.windows.map((w) =>
      `  window ${w.idx} (${hhmm(w.startSeconds)}-${hhmm(w.endSeconds)}): ` +
      (w.reading
        ? `${w.reading.summary} | touched: [${w.reading.scopeTouched.join(',')}]` +
          (w.reading.couldNotTell.length ? ` | unclear: ${w.reading.couldNotTell.join('; ')}` : '')
        : 'unreadable'),
    ),
    '',
    'Return STRICT JSON only:',
    '{"verdicts": [{"line": 0, "verdict": "appears_complete"|"in_progress"|"not_visible", "because": "..."}], "narrative": "...", "couldNotTell": ["..."]}',
    '',
    'Rules:',
    '1. One verdict per scope line, every line, cited by index.',
    '2. "appears_complete" is the STRONGEST claim available — you are reading footage, not inspecting the site, and the wording stays that way. Never claim completion for a line no window touched.',
    '3. The narrative tells the day in order, 4-8 sentences, citing times (window ranges) for the major work. Plain words a project manager reads in thirty seconds.',
    '4. couldNotTell: what the whole day\'s footage could not establish. Owed, not optional.',
  ].join('\n');
}

/**
 * Parse the synthesis, then enforce the sighting rule: a verdict can never
 * be stronger than its evidence. No sightings → not_visible, one window →
 * at most in_progress, whatever the prose said.
 */
export function parseDayReport(
  raw: string,
  scopeTitles: string[],
  sightings: number[][],
  model: string,
): DayReport | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof parsed?.narrative !== 'string' || !Array.isArray(parsed.verdicts)) return null;

  const byLine = new Map<number, { verdict: string; because: string }>();
  for (const v of parsed.verdicts) {
    if (Number.isInteger(v?.line) && v.line >= 0 && v.line < scopeTitles.length) {
      byLine.set(v.line, {
        verdict: v.verdict,
        because: typeof v.because === 'string' ? v.because.trim().slice(0, 400) : '',
      });
    }
  }

  const verdicts = scopeTitles.map((title, i) => {
    const seen = sightings[i] ?? [];
    const claimed = byLine.get(i);
    let verdict: LineVerdict =
      claimed?.verdict === 'appears_complete' || claimed?.verdict === 'in_progress' || claimed?.verdict === 'not_visible'
        ? claimed.verdict
        : 'not_visible';
    // The cap: evidence bounds the claim.
    if (seen.length === 0) verdict = 'not_visible';
    else if (seen.length === 1 && verdict === 'appears_complete') verdict = 'in_progress';
    return {
      title,
      verdict,
      because:
        claimed?.because ||
        (seen.length === 0 ? 'No window of the recording shows this line being worked.' : ''),
      seenInWindows: seen,
    };
  });

  return {
    verdicts,
    narrative: parsed.narrative.trim().slice(0, 4000),
    couldNotTell: Array.isArray(parsed.couldNotTell)
      ? parsed.couldNotTell.filter((s: unknown) => typeof s === 'string' && (s as string).trim()).map((s: string) => s.trim().slice(0, 300)).slice(0, 10)
      : [],
    model,
  };
}

/* ------------------------------------------------------------------ *
 * The runner
 * ------------------------------------------------------------------ */

async function readWindow(
  scopeTitles: string[],
  frames: Array<{ atSeconds: number; base64: string }>,
  window: Window,
): Promise<WindowReading | null> {
  const content: any[] = [];
  for (const idx of window.frameIdxs) {
    const frame = frames[idx];
    content.push({ type: 'text', text: `at ${Math.round(frame.atSeconds)}s:` });
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: frame.base64 },
    });
  }
  const response = await anthropicClient().messages.create({
    model: config.technician.assistant.liveModel,
    max_tokens: 400,
    // The system + scope list is identical across every window of the run:
    // cached once, read N times.
    system: [{ type: 'text', text: windowPrompt(scopeTitles), cache_control: { type: 'ephemeral' } }] as any,
    messages: [{ role: 'user', content }],
  });
  const text = response.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n');
  return parseWindowReading(text, scopeTitles.length);
}

export interface LongFormResult {
  report: DayReport;
  windows: Array<{
    idx: number;
    startSeconds: number;
    endSeconds: number;
    frameCount: number;
    reading: WindowReading | null;
  }>;
}

/**
 * The whole pipeline: segment, read every window on the cheap model,
 * synthesize on the mid tier, cap verdicts by sightings.
 */
export async function analyseLongRecording(input: {
  frames: Array<{ atSeconds: number; base64: string }>;
  scopeTitles: string[];
  durationSeconds: number;
}): Promise<LongFormResult | null> {
  const windows = segmentFrames(input.frames, {
    maxFrames: config.verification.windowMaxFrames,
    maxSeconds: config.verification.windowMaxSeconds,
  });
  if (!windows.length) return null;

  const readings: Array<{ idx: number; startSeconds: number; endSeconds: number; frameCount: number; reading: WindowReading | null }> = [];
  for (const window of windows) {
    let reading: WindowReading | null = null;
    try {
      reading = await readWindow(input.scopeTitles, input.frames, window);
    } catch {
      // One unreadable window degrades the timeline, never the run: the
      // synthesis sees "unreadable" and the coverage math simply lacks it.
      reading = null;
    }
    readings.push({
      idx: window.idx,
      startSeconds: window.startSeconds,
      endSeconds: window.endSeconds,
      frameCount: window.frameIdxs.length,
      reading,
    });
  }

  const sightings = scopeSightings(readings, input.scopeTitles.length);
  const totalHours = (input.durationSeconds / 3600).toFixed(1);

  const response = await anthropicClient().messages.create({
    model: config.verification.synthesisModel,
    max_tokens: 2500,
    system: synthesisPrompt({ scopeTitles: input.scopeTitles, totalHours, windows: readings }),
    messages: [{ role: 'user', content: 'Write the day report.' }],
  });
  const text = response.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n');
  const report = parseDayReport(text, input.scopeTitles, sightings, response.model);
  if (!report) return null;

  return { report, windows: readings };
}
