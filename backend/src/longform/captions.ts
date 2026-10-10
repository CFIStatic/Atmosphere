/**
 * One-line keyframe captions for the base timeline. Cheapest tier first
 * (Gemini Flash-Lite, thinking off, closed JSON), batched; low-confidence
 * captions are re-read once by a stronger Flash model. Every frame gets a
 * caption row even when the model fails (status "unread"), so coverage is
 * never silently lost.
 */

import { geminiMeasuredUsage } from '../lib/providerUsage.js';
import { googleVisionApiKey } from '../lib/visionProvider.js';
import { meterBackgroundUsage } from '../metering/backgroundUsage.js';
import type { MeasuredUsage } from '../lib/anthropic.js';

export const CAPTION_ACTIVITIES = [
  'site_work', 'walkthrough', 'talking', 'driving', 'break', 'pocket_or_dark', 'screen_or_media', 'idle', 'other',
] as const;
export type CaptionActivity = (typeof CAPTION_ACTIVITIES)[number];

export type FrameCaption = {
  atSeconds: number;
  caption: string;
  activity: CaptionActivity;
  room: string | null;
  confidence: number;
  model: string | null;
  status: 'ok' | 'reread' | 'unread';
};

export type CaptionFrame = { atSeconds: number; base64: string };

export type GeminiCall = (input: {
  model: string;
  system: string;
  parts: Array<Record<string, unknown>>;
}) => Promise<{ text: string; usage: MeasuredUsage | null; model: string }>;

export const CAPTION_SYSTEM = `You caption keyframes from a long job-site recording. One entry per frame, in order.
For each frame: a single factual sentence of what is visible (max 20 words), the activity, the room or area if identifiable, and your confidence 0-1.
activity MUST be one of: ${CAPTION_ACTIVITIES.join(', ')}.
Only what the frame shows. Never guess names, never infer completed work that is not visible. Low light or a blocked lens is pocket_or_dark.
Reply JSON only: {"frames":[{"frame":0,"caption":"...","activity":"site_work","room":"kitchen"|null,"confidence":0.8}]}`;

export function parseCaptions(text: string, frames: Array<{ atSeconds: number }>, model: string): Map<number, FrameCaption> {
  const out = new Map<number, FrameCaption>();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return out;
  }
  const rows = (parsed as { frames?: unknown }).frames;
  if (!Array.isArray(rows)) return out;
  for (const row of rows as Array<Record<string, unknown>>) {
    const i = Number(row?.frame);
    if (!Number.isInteger(i) || i < 0 || i >= frames.length) continue;
    const caption = String(row.caption ?? '').trim().slice(0, 200);
    if (!caption) continue;
    const act = String(row.activity ?? 'other') as CaptionActivity;
    const conf = Number(row.confidence);
    out.set(i, {
      atSeconds: frames[i]!.atSeconds,
      caption,
      activity: (CAPTION_ACTIVITIES as readonly string[]).includes(act) ? act : 'other',
      room: row.room ? String(row.room).trim().slice(0, 60) || null : null,
      confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0,
      model,
      status: 'ok',
    });
  }
  return out;
}

/** Default Gemini caller (REST). Flash-Lite rejects thinkingConfig, so none is sent for lite ids. */
export const defaultGeminiCall: GeminiCall = async ({ model, system, parts }) => {
  const key = googleVisionApiKey();
  if (!key) throw new Error('No GEMINI_API_KEY / GOOGLE_API_KEY');
  const generationConfig: Record<string, unknown> = { responseMimeType: 'application/json', maxOutputTokens: 4096 };
  if (/^gemini-3/i.test(model) && !/lite/i.test(model)) generationConfig.thinkingConfig = { thinkingLevel: 'low' };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts }],
        generationConfig,
      }),
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (!res.ok) throw new Error(`gemini ${model} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
    usageMetadata?: unknown;
    modelVersion?: string;
  };
  const text = (body.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('');
  const used = body.modelVersion || model;
  return { text, usage: geminiMeasuredUsage(body.usageMetadata ?? null, used), model: used };
};

function framesParts(frames: CaptionFrame[]): Array<Record<string, unknown>> {
  return frames.flatMap((f, i) => [
    { text: `frame ${i} at ${Math.round(f.atSeconds)}s:` },
    { inlineData: { mimeType: 'image/jpeg', data: f.base64 } },
  ]);
}

export type CaptionRunOptions = {
  model: string;
  rereadModel: string;
  rereadBelow: number;
  batch: number;
  call?: GeminiCall;
  /** Called with each call's usage (metering / eval spend guard). Throwing aborts the run. */
  onUsage?: (u: { model: string; usage: MeasuredUsage | null; stage: 'caption' | 'reread' }) => void;
};

async function captionBatch(
  frames: CaptionFrame[],
  model: string,
  call: GeminiCall,
  stage: 'caption' | 'reread',
  onUsage?: CaptionRunOptions['onUsage'],
): Promise<Map<number, FrameCaption>> {
  const res = await call({ model, system: CAPTION_SYSTEM, parts: framesParts(frames) });
  meterBackgroundUsage({ source: stage === 'caption' ? 'timeline_caption' : 'timeline_caption_reread', modelId: res.model, usage: res.usage });
  onUsage?.({ model: res.model, usage: res.usage, stage });
  return parseCaptions(res.text, frames, res.model);
}

/** Caption every frame. Returns exactly one row per input frame, in order. */
export async function captionFrames(frames: CaptionFrame[], opts: CaptionRunOptions): Promise<FrameCaption[]> {
  const call = opts.call ?? defaultGeminiCall;
  const result: FrameCaption[] = frames.map((f) => ({
    atSeconds: f.atSeconds, caption: '', activity: 'other', room: null, confidence: 0, model: null, status: 'unread',
  }));
  const size = Math.max(1, opts.batch);
  for (let i = 0; i < frames.length; i += size) {
    const slice = frames.slice(i, i + size);
    try {
      const got = await captionBatch(slice, opts.model, call, 'caption', opts.onUsage);
      for (const [j, c] of got) result[i + j] = c;
    } catch (err) {
      if ((err as { spendCap?: boolean })?.spendCap) throw err;
    }
  }
  // Re-read unsure or unread frames once with the stronger model.
  const redo = result.map((c, i) => ({ c, i })).filter(({ c }) => c.status === 'unread' || c.confidence < opts.rereadBelow);
  for (let k = 0; k < redo.length; k += size) {
    const group = redo.slice(k, k + size);
    try {
      const got = await captionBatch(group.map(({ i }) => frames[i]!), opts.rereadModel, call, 'reread', opts.onUsage);
      for (const [j, c] of got) result[group[j]!.i] = { ...c, status: 'reread' };
    } catch (err) {
      if ((err as { spendCap?: boolean })?.spendCap) throw err;
    }
  }
  return result;
}
