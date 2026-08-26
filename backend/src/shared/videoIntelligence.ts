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

export type VideoDictationResult = {
  narrationText: string;
  narrationSummary: string | null;
  model: string;
  frameCount: number;
  actions: VisionAction[];
};

export function isLongFormVideo(durationSeconds: number): boolean {
  return durationSeconds >= config.verification.longFormSeconds;
}

/** Gemini hanging used to leave narration_status=running forever. */
export function geminiDictationTimeoutMs(): number {
  const n = Number(process.env.GEMINI_DICTATION_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 60_000;
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
    candidateIntervalSeconds:
      config.verification.sparseCandidateIntervalSeconds ||
      config.verification.sparseFrameIntervalSeconds,
    hammingThreshold: config.verification.sparseDiversityHamming,
    coverageIntervalSeconds: config.verification.sparseCoverageIntervalSeconds,
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

  const maxModel = Math.max(4, Math.min(opts?.maxModelFrames ?? 36, 48));
  const frames = pickEvenlySpaced(prepared.frames, maxModel);
  const hours = (prepared.durationSeconds / 3600).toFixed(2);
  const context = (opts?.contextText ?? '').trim().slice(0, 4000);

  const system = [
    'You are watching a filed video. It may be job-site work, a walkthrough, a conversation, or someone filming a room, a desk, or a screen.',
    'Watch the provided stills (sampled across the recording, including long day-long clips) and dictate what is on camera.',
    'Write as spoken field notes an office person can read beside the video player.',
    'Describe only what is visible. Never infer off-camera work or invent rooms.',
    'Cover whatever is actually there: people, setting (desk, kitchen, truck, living room), tools, materials, AND screens — TV, laptop, phone, YouTube, news logos, on-screen text, a race or story being discussed.',
    'If the clip is a broadcast or YouTube video, name the network or show when readable (MSNBC, a chyron, a senate race) and say the camera is at a desk if that is what you see.',
    'Name the room or area when you can see it. If you cannot tell, omit it.',
    'Be concrete and chronological. Do not invent invoice amounts or people identities.',
    'If the clip is long, summarize with time cues when timestamps are given.',
    'Also list distinct visible actions. Sitting, watching, talking, and pointing at a screen count.',
    'action MUST be one of: locate, measure, mark, pick_up, carry, position, align, cut, drill, fasten, apply, connect, test, inspect, remove, clean, protect, correct, wait, watch, talk, other.',
    'atSeconds MUST match a provided frame timestamp. Never invent off-camera work.',
    'Reply with JSON only: {"narration":"...","summary":"...","actions":[{"atSeconds":number,"action":"watch","room":"office","description":"...","object":"...","tool":"...","material":"...","objects":["..."],"confidence":0.0}]}',
    'summary is 2–4 sentences that would answer "what is happening in this video". actions may be an empty array.',
  ].join(' ');

  const userText = [
    `Source: ${prepared.source}`,
    `Video id: ${prepared.id}`,
    `Duration: ${prepared.durationSeconds}s (~${hours}h)`,
    `Stills: ${frames.length} of ${prepared.frames.length} prepared (diverse sample)`,
    context ? `Context:\n${context}` : 'Context: (none)',
    'Dictate what the video shows for the office verifier. JSON only.',
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
    max_tokens: 2500,
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

  return {
    narrationText: parsed.narration,
    narrationSummary: parsed.summary,
    model: response.model,
    frameCount: frames.length,
    actions: parsed.actions,
  };
}

async function dictateWithGemini(input: {
  apiKey: string;
  system: string;
  userText: string;
  frames: PreparedVideoFrame[];
}): Promise<VideoDictationResult> {
  const model = verificationConfig.primaryModel;
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
        maxOutputTokens: 2500,
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
  return {
    narrationText: parsed.narration,
    narrationSummary: parsed.summary,
    model,
    frameCount: input.frames.length,
    actions: parsed.actions,
  };
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

/** Exported for tests — dictation JSON must stay parseable without a live model. */
export function parseDictationPayload(
  text: string,
  frames?: number[],
  model?: string | null,
): { narration: string; summary: string | null; actions: VisionAction[] } {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    const trimmed = text.trim();
    return { narration: trimmed, summary: null, actions: [] };
  }
  try {
    const data = JSON.parse(text.slice(start, end + 1)) as {
      narration?: unknown;
      summary?: unknown;
      actions?: unknown;
    };
    return {
      narration: String(data.narration ?? '').trim(),
      summary: String(data.summary ?? '').trim() || null,
      actions: parseVisionActions(data.actions, { frames, model: model ?? null }),
    };
  } catch {
    return { narration: text.trim(), summary: null, actions: [] };
  }
}
