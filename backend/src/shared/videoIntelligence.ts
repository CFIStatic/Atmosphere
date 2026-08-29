/**
 * Source-agnostic video intelligence.
 *
 * Any inbound video (proof of work, field capture, CRM attachment, uploaded
 * media, external URL, …) can call the same pipeline:
 *
 *   1. prepareVideoFrames — sparse sample + diversity filter (incl. ~24h)
 *   2. dictatePreparedFrames — office-facing AI dictation over those frames
 *
 * One processed object is at most ~24h. Fleet retention of many such objects
 * (billions of hours aggregate) is the media catalog + object storage
 * (`docs/media-storage.md`) — this module only needs a signed URL.
 *
 * Persistence stays in the caller. New ingress points only need a fetchable
 * URL, a duration, and optional context text — not a proof row.
 */
import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';
import { anthropicClient } from '../lib/anthropic.js';
import { googleVisionApiKeys, isVisionConfigured } from '../lib/visionProvider.js';
import { verificationConfig } from '../verification/config.js';
import {
  extractSparseFramesFromUrl,
  type CommandRunner,
} from './sparseExtract.js';
import { parseVisionActions, type VisionAction } from './proofActions.js';

export type VideoSourceKind =
  | 'proof_of_work'
  | 'field_capture'
  | 'media_upload'
  | 'crm_attachment'
  | 'external'
  | 'unknown';

export type InboundVideoRef = {
  /** Opaque id for logging / correlation (proof id, capture id, …). */
  id: string;
  /** Where the bytes came from — does not change processing. */
  source: VideoSourceKind;
  /** Signed (or otherwise fetchable) HTTPS URL to the video object. */
  url: string;
  durationSeconds: number;
  mimeType?: string | null;
  /** Optional human / job context injected into dictation. */
  contextText?: string | null;
  /** Soft cap on frames after diversity (overrides config when set). */
  maxFrames?: number;
};

export type PreparedVideoFrame = {
  atSeconds: number;
  jpeg: Buffer;
  reason?: string;
};

export type PreparedVideoFrames = {
  id: string;
  source: VideoSourceKind;
  durationSeconds: number;
  frames: PreparedVideoFrame[];
  longForm: boolean;
};

export const DENSE_READING_LEVEL = 'dense';

export type DictationEntry = {
  atSeconds: number;
  text: string;
};

export type VideoDictationResult = {
  narrationText: string;
  narrationSummary: string | null;
  model: string;
  frameCount: number;
  actions: VisionAction[];
  entries: DictationEntry[];
  cannotTell: string[];
};

export function isLongFormVideo(durationSeconds: number): boolean {
  return durationSeconds >= config.verification.longFormSeconds;
}

/** Gemini hanging used to leave narration_status=running forever. */
export function geminiDictationTimeoutMs(): number {
  const n = Number(process.env.GEMINI_DICTATION_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 90_000;
}

/** Short clips need stills every few seconds, not the 2-minute day-film cadence. */
export function shortClipFrameIntervalSeconds(durationSeconds: number, maxFrames: number): number {
  const duration = Math.max(1, Number(durationSeconds) || 1);
  const keep = Math.max(4, Math.min(Math.floor(maxFrames) || 24, 24));
  return Math.max(3, Math.floor(duration / keep));
}

export function snapToFrameSeconds(raw: unknown, frames?: number[]): number {
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

export function assertProcessableDuration(durationSeconds: number): void {
  const max = config.verification.maxDurationSeconds;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new HttpError(400, 'durationSeconds must be a positive number', 'invalid_duration');
  }
  if (durationSeconds > max) {
    throw new HttpError(
      400,
      `Video exceeds maximum processable duration (${max}s / ~${Math.round(max / 3600)}h)`,
      'duration_too_long',
    );
  }
}

/** Convert prepared JPEGs into the base64 shape existing analysts expect. */
export function framesToBase64(
  frames: PreparedVideoFrame[],
): Array<{ atSeconds: number; base64: string }> {
  return frames.map((f) => ({
    atSeconds: f.atSeconds,
    base64: f.jpeg.toString('base64'),
  }));
}

/**
 * Pull diverse stills from any fetchable video URL.
 * Works for short clips and up to ~24h long-form (config-capped).
 */
export async function prepareVideoFrames(
  ref: InboundVideoRef,
  opts?: { runner?: CommandRunner },
): Promise<PreparedVideoFrames> {
  assertProcessableDuration(ref.durationSeconds);
  const maxFrames = Math.max(
    1,
    Math.min(ref.maxFrames ?? config.verification.sparseMaxFrames, config.verification.sparseMaxFrames),
  );
  const longForm = isLongFormVideo(ref.durationSeconds);

  const frames = await extractSparseFramesFromUrl({
    url: ref.url,
    durationSeconds: ref.durationSeconds,
    maxFrames,
    candidateIntervalSeconds: longForm
      ? config.verification.sparseCandidateIntervalSeconds ||
        config.verification.sparseFrameIntervalSeconds
      : shortClipFrameIntervalSeconds(ref.durationSeconds, maxFrames),
    hammingThreshold: config.verification.sparseDiversityHamming,
    coverageIntervalSeconds: longForm
      ? config.verification.sparseCoverageIntervalSeconds
      : Math.max(8, shortClipFrameIntervalSeconds(ref.durationSeconds, maxFrames) * 2),
    ffmpegPath: config.verification.ffmpegPath,
    runner: opts?.runner,
  });

  return {
    id: ref.id,
    source: ref.source,
    durationSeconds: ref.durationSeconds,
    frames,
    longForm,
  };
}

/**
 * Turn prepared frames into office-facing dictation text.
 * No DB writes — caller persists wherever the video came from.
 *
 * Caps the model payload so a 24h diverse set stays affordable; the diversity
 * pass already kept scene changes, so a spaced subset still covers the day.
 */
export async function dictatePreparedFrames(
  prepared: PreparedVideoFrames,
  opts?: { contextText?: string | null; maxModelFrames?: number },
): Promise<VideoDictationResult> {
  if (!isVisionConfigured()) {
    throw new HttpError(503, 'Model access is not configured on this server.', 'model_provider_unconfigured');
  }
  if (prepared.frames.length === 0) {
    throw new HttpError(422, 'No frames available for dictation', 'no_frames');
  }

  const maxModel = Math.max(4, Math.min(opts?.maxModelFrames ?? 48, 48));
  const frames = pickEvenlySpaced(prepared.frames, maxModel);
  const hours = (prepared.durationSeconds / 3600).toFixed(2);
  const context = (opts?.contextText ?? '').trim().slice(0, 4000);
  const frameClock = frames.map((frame, i) => `${i}=${Math.round(frame.atSeconds)}s`).join(', ');

  const system = [
    'You are watching stills from a filed video. Write a field-note reading an office person can read beside the player without watching the clip.',
    'Keep the timestamps. For every still you are given, write a dense note at that still\'s timestamp.',
    'Visible-only. Never invent off-camera work, people identities, invoice amounts, or rooms you cannot see. If text is unreadable, say so. Unknown is allowed. Unknown is not a pass.',
    'Extract every relevant visible fact:',
    'setting (room or area, indoor/outdoor, light, weather clues);',
    'people (count, clothing, PPE, pose, what each person is doing with their hands);',
    'work (tools, materials, brands or labels when readable, condition such as wet/torn/new/damaged, quantities you can count);',
    'surfaces (walls, floors, ceilings, openings, water lines, debris);',
    'screens (TV, laptop, phone, app, network or show, chyron, on-screen text, what the story is);',
    'vehicles, signage, house numbers, safety setup;',
    'what changed between stills;',
    'what a PM would want that these stills do not show (cannotTell).',
    'Name the room when you can see it. If you cannot tell, omit it rather than guess.',
    'Sitting, watching, talking, and pointing at a screen count as actions.',
    'action MUST be one of: locate, measure, mark, pick_up, carry, position, align, cut, drill, fasten, apply, connect, test, inspect, remove, clean, protect, correct, wait, watch, talk, other.',
    'atSeconds MUST be one of the provided still timestamps. Never invent a time.',
    'narration is chronological prose, several paragraphs if needed, still concrete.',
    'summary is 2–4 sentences answering "what is happening in this video".',
    'entries: one object per still. text is 2–6 sentences of everything relevant in that still.',
    'cannotTell lists facts the stills do not show. actions may be an empty array.',
    'Reply with JSON only: {"narration":"...","summary":"...","entries":[{"atSeconds":number,"text":"..."}],"cannotTell":["..."],"actions":[{"atSeconds":number,"action":"watch","room":"office","description":"...","object":"...","tool":"...","material":"...","objects":["..."],"confidence":0.0}]}',
  ].join(' ');

  const userText = [
    `Source: ${prepared.source}`,
    `Video id: ${prepared.id}`,
    `Duration: ${prepared.durationSeconds}s (~${hours}h)`,
    `Stills: ${frames.length} of ${prepared.frames.length} prepared (diverse sample)`,
    `Still timestamps: ${frameClock}`,
    context ? `Context:\n${context}` : 'Context: (none)',
    'Write a dense timestamped reading. One entry per still. JSON only.',
  ].join('\n');

  const googleKeys = googleVisionApiKeys();
  let lastGoogleError: unknown;
  for (const apiKey of googleKeys) {
    try {
      return await dictateWithGemini({
        apiKey,
        system,
        userText,
        frames,
      });
    } catch (err) {
      lastGoogleError = err;
      console.warn(
        '[dictation] Gemini key failed, trying next provider:',
        err instanceof Error ? err.message : err,
      );
    }
  }
  if (!config.anthropic.apiKey) {
    throw lastGoogleError instanceof Error
      ? lastGoogleError
      : new Error('Gemini vision is not configured.');
  }

  const response = await anthropicClient().messages.create({
    model: config.technician.assistant.model,
    max_tokens: 8192,
    system,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: userText },
          ...frames.flatMap((frame, i) => [
            {
              type: 'text' as const,
              text: `frame ${i} — at ${Math.round(frame.atSeconds)}s:`,
            },
            {
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: 'image/jpeg' as const,
                data: frame.jpeg.toString('base64'),
              },
            },
          ]),
        ],
      },
    ],
  });

  const text = response.content
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { type: string; text?: string }) => b.text ?? '')
    .join('\n');
  const parsed = parseDictationPayload(
    text,
    frames.map((frame) => frame.atSeconds),
    response.model,
  );
  if (!parsed.narration) {
    throw new HttpError(502, 'Dictation model returned empty narration', 'empty_dictation');
  }

  return toDictationResult(parsed, frames.length, response.model);
}

async function dictateWithGemini(input: {
  apiKey: string;
  system: string;
  userText: string;
  frames: PreparedVideoFrame[];
  model?: string;
}): Promise<VideoDictationResult> {
  const model = input.model || verificationConfig.primaryModel;
  const baseUrl = (process.env.GOOGLE_BASE_URL || 'https://generativelanguage.googleapis.com').replace(
    /\/+$/,
    '',
  );
  const url = `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': input.apiKey },
      signal: AbortSignal.timeout(geminiDictationTimeoutMs()),
      body: JSON.stringify({
      system_instruction: { parts: [{ text: input.system }] },
      contents: [
        {
          role: 'user',
          parts: [
            { text: input.userText },
            ...input.frames.flatMap((frame, i) => [
              { text: `frame ${i} — at ${Math.round(frame.atSeconds)}s:` },
              { inline_data: { mime_type: 'image/jpeg', data: frame.jpeg.toString('base64') } },
            ]),
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0,
        maxOutputTokens: 8192,
      },
    }),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new Error(`Gemini vision timed out after ${geminiDictationTimeoutMs()}ms`);
    }
    throw err;
  }
  if (!response.ok) {
    const errText = await response.text();
    if (response.status === 403 && /API_KEY_SERVICE_BLOCKED|are blocked/i.test(errText)) {
      throw new Error(
        'Gemini vision error 403: API_KEY_SERVICE_BLOCKED — this key cannot call generativelanguage.googleapis.com',
      );
    }
    const suggested = errText.match(/use models\/([a-z0-9._-]+)/i)?.[1];
    if (response.status === 404 && suggested && suggested !== model && !input.model) {
      console.warn(`[dictation] ${model} is retired, retrying ${suggested}`);
      return dictateWithGemini({ ...input, model: suggested });
    }
    throw new Error(`Gemini vision error ${response.status}: ${errText.slice(0, 400)}`);
  }
  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = (payload.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('\n');
  const parsed = parseDictationPayload(
    text,
    input.frames.map((frame) => frame.atSeconds),
    model,
  );
  if (!parsed.narration) {
    throw new HttpError(502, 'Dictation model returned empty narration', 'empty_dictation');
  }
  return toDictationResult(parsed, input.frames.length, model);
}

/**
 * Full pipeline: prepare frames + dictate. Source-agnostic; no persistence.
 */
export async function processInboundVideo(
  ref: InboundVideoRef,
  opts?: { runner?: CommandRunner },
): Promise<{ prepared: PreparedVideoFrames; dictation: VideoDictationResult }> {
  const prepared = await prepareVideoFrames(ref, opts);
  const dictation = await dictatePreparedFrames(prepared, { contextText: ref.contextText });
  return { prepared, dictation };
}

/** Stable content fingerprint for a set of frame bytes (logging / dedupe keys). */
export function framesContentFingerprint(frames: Array<{ jpeg: Buffer }>): string {
  const h = createHash('sha256');
  for (const f of frames) h.update(f.jpeg);
  return h.digest('hex').slice(0, 32);
}

/** Exported for tests — evenly space a subset across a long keep list. */
export function pickEvenlySpaced<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items.slice();
  if (max <= 1) return items.slice(0, 1);
  const out: T[] = [];
  for (let i = 0; i < max; i += 1) {
    const idx = Math.round((i * (items.length - 1)) / (max - 1));
    out.push(items[idx]!);
  }
  return out;
}

const MAX_ENTRY_CHARS = 1600;
const MAX_ENTRIES = 48;
const MAX_CANNOT_TELL = 12;

export function parseDictationEntries(raw: unknown, frames?: number[]): DictationEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: DictationEntry[] = [];
  const seen = new Set<number>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { atSeconds?: unknown; at_seconds?: unknown; text?: unknown; note?: unknown; summary?: unknown };
    const text = String(row.text ?? row.note ?? row.summary ?? '').trim().slice(0, MAX_ENTRY_CHARS);
    if (!text) continue;
    const atSeconds = snapToFrameSeconds(row.atSeconds ?? row.at_seconds, frames);
    if (seen.has(atSeconds)) {
      const existing = out.find((e) => e.atSeconds === atSeconds);
      if (existing && existing.text.length < text.length) existing.text = text;
      continue;
    }
    seen.add(atSeconds);
    out.push({ atSeconds, text });
    if (out.length >= MAX_ENTRIES) break;
  }
  return out.sort((a, b) => a.atSeconds - b.atSeconds);
}

export function parseCannotTell(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const next = item.trim().slice(0, 240);
    if (!next || seen.has(next.toLowerCase())) continue;
    seen.add(next.toLowerCase());
    out.push(next);
    if (out.length >= MAX_CANNOT_TELL) break;
  }
  return out;
}

export function entriesFromActions(actions: VisionAction[]): DictationEntry[] {
  return actions
    .filter((action) => action.description.trim())
    .slice(0, MAX_ENTRIES)
    .map((action) => ({ atSeconds: action.atSeconds, text: action.description.trim().slice(0, MAX_ENTRY_CHARS) }));
}

export function entriesFromDictation(dictation: {
  entries?: Array<{ atSeconds: number; text?: string; note?: string }>;
  actions?: VisionAction[];
}): DictationEntry[] {
  if (dictation.entries?.length) return verifierDictationEntries(dictation.entries);
  return entriesFromActions(dictation.actions ?? []);
}

/** Side timestamps in verifier/index.html read `e.text || e.note`. Always persist `text`. */
export function verifierDictationEntries(
  entries: Array<{ atSeconds: number; text?: string | null; note?: string | null }>,
): DictationEntry[] {
  return entries
    .map((entry) => ({
      atSeconds: entry.atSeconds,
      text: String(entry.text || entry.note || '').trim(),
    }))
    .filter((entry) => entry.text)
    .slice(0, MAX_ENTRIES);
}

function toDictationResult(
  parsed: ParsedDictation,
  frameCount: number,
  model: string,
): VideoDictationResult {
  const entries = parsed.entries.length ? parsed.entries : entriesFromActions(parsed.actions);
  return {
    narrationText: parsed.narration,
    narrationSummary: parsed.summary,
    model,
    frameCount,
    actions: parsed.actions,
    entries,
    cannotTell: parsed.cannotTell,
  };
}

type ParsedDictation = {
  narration: string;
  summary: string | null;
  actions: VisionAction[];
  entries: DictationEntry[];
  cannotTell: string[];
};

/** Exported for tests — dictation JSON must stay parseable without a live model. */
export function parseDictationPayload(
  text: string,
  frames?: number[],
  model?: string | null,
): ParsedDictation {
  const empty = (narration: string): ParsedDictation => ({
    narration,
    summary: null,
    actions: [],
    entries: [],
    cannotTell: [],
  });
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return empty(text.trim());
  }
  try {
    const data = JSON.parse(text.slice(start, end + 1)) as {
      narration?: unknown;
      summary?: unknown;
      actions?: unknown;
      entries?: unknown;
      cannotTell?: unknown;
      cannot_tell?: unknown;
    };
    const actions = parseVisionActions(data.actions, { frames, model: model ?? null });
    return {
      narration: String(data.narration ?? '').trim(),
      summary: String(data.summary ?? '').trim() || null,
      actions,
      entries: parseDictationEntries(data.entries, frames),
      cannotTell: parseCannotTell(data.cannotTell ?? data.cannot_tell),
    };
  } catch {
    return empty(text.trim());
  }
}
