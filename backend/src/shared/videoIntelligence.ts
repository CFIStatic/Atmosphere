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
  candidateIntervalForClip,
  extractSparseFramesFromUrl,
  type CommandRunner,
} from './sparseExtract.js';
import { parseVisionActions, type VisionAction } from './proofActions.js';
import {
  eventsFromActions,
  parseDictationEvents,
  parseTimestampedNarration,
  sanitizeDictationEvents,
  type DictationEvent,
} from './dictationEvents.js';
import {
  parsePrivacyRedactions,
  type PrivacyRedactionRange,
} from '../audio/privacyRedactions.js';
import {
  parseChildPrivacyRedactions,
  type ChildPrivacyRange,
} from '../audio/childPrivacyRedactions.js';

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
  /** Event-boundary beats for the Analysis list (not a fixed cadence). */
  events: DictationEvent[];
  /** Distinct people visible — roles + appearance; never hallucinated legal names. */
  people: unknown[];
  /** Private intervals to blur+mute (bathroom, undressing, intimate spaces). */
  privacyRedactions: PrivacyRedactionRange[];
  /** Child privacy intervals (age appearance child vs adult only — never identify). */
  childPrivacyRedactions: ChildPrivacyRange[];
};

export function isLongFormVideo(durationSeconds: number): boolean {
  return durationSeconds >= config.verification.longFormSeconds;
}

/** Gemini hanging used to leave narration_status=running forever. */
export function geminiDictationTimeoutMs(): number {
  const n = Number(process.env.GEMINI_DICTATION_TIMEOUT_MS);
  // Pro + dense JSON needs more headroom than Flash; override via env when needed.
  return Number.isFinite(n) && n > 0 ? n : 120_000;
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
  const duration = Number(ref.durationSeconds);
  if (Number.isFinite(duration) && duration > config.verification.maxDurationSeconds) {
    throw new HttpError(
      400,
      `Video exceeds maximum processable duration (${config.verification.maxDurationSeconds}s / ~${Math.round(config.verification.maxDurationSeconds / 3600)}h)`,
      'duration_too_long',
    );
  }
  // duration 0 / NaN = unknown (MediaRecorder WebM, a screenshot, a still).
  // The extractor grabs the first decoded frames instead of refusing the file.
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const maxFrames = Math.max(
    1,
    Math.min(ref.maxFrames ?? config.verification.sparseMaxFrames, config.verification.sparseMaxFrames),
  );
  const longForm = isLongFormVideo(safeDuration);

  const frames = await extractSparseFramesFromUrl({
    url: ref.url,
    durationSeconds: safeDuration,
    maxFrames,
    candidateIntervalSeconds: candidateIntervalForClip(
      safeDuration,
      config.verification.sparseCandidateIntervalSeconds ||
        config.verification.sparseFrameIntervalSeconds,
    ),
    hammingThreshold: config.verification.sparseDiversityHamming,
    coverageIntervalSeconds: config.verification.sparseCoverageIntervalSeconds,
    ffmpegPath: config.verification.ffmpegPath,
    runner: opts?.runner,
  });

  return {
    id: ref.id,
    source: ref.source,
    durationSeconds: safeDuration,
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

  const maxModel = Math.max(4, Math.min(opts?.maxModelFrames ?? 42, 48));
  const frames = pickEvenlySpaced(prepared.frames, maxModel);
  const hours = (prepared.durationSeconds / 3600).toFixed(2);
  const context = (opts?.contextText ?? '').trim().slice(0, 4000);

  const system = [
    'You are reconstructing a filed video for an office that must know EXACTLY what happened.',
    'Watch the provided stills (sampled across the recording, including long day-long clips) and produce a dense, timed evidence log of what is on camera.',
    'ACCURACY OVER BREVITY. Prefer many precise timed beats over a short summary. These films are analyzed to find out what occurred — reconstruct the job/event over time.',
    'Describe ONLY what is visible or clearly evidenced in the stills. Never invent off-camera work, rooms, people, objects, dialogue, or motives.',
    'UNCERTAINTY: when you cannot tell, say so explicitly in the event/narration (e.g. "unclear whether…", "possibly…", "cannot confirm…"). Never pad with plausible fiction. Prefer omitting a guess over inventing detail.',
    'DENSE LOG — every distinct person, object interaction, room/scene change, camera move, tool/material use, and work beat must appear in events with a seek time.',
    'Cover whatever is actually there: people, setting (desk, kitchen, truck, living room), tools, materials, fixtures, equipment, damage/conditions, AND screens — TV, laptop, phone, YouTube, news logos, on-screen text, a race or story being discussed.',
    'If the clip is a broadcast or YouTube video, name the network or show when readable (MSNBC, a chyron, a senate race) and say the camera is at a desk if that is what you see.',
    'Name the room or area when you can see it. If you cannot tell, write "room unclear" rather than inventing one.',
    'CONTEXT/WHY: when job phase, scope line, or situation is visible or given in Context, state it; otherwise leave it out — do not invent why.',
    'Be concrete and chronological. Do not invent invoice amounts or people identities.',
    'PEOPLE: list every distinct visible person in "people". Use labels like "Person 1 (crew-like)" or "Person 2 (homeowner-like)". Include appearance (PPE, clothing, build) when identity is unknown.',
    'Role may be crew, homeowner, adjuster, inspector, other, or unknown when inferable from clothing/context — NEVER invent a legal name from faces alone. Only put a real name in matchedName when a name tag or readable badge is visible.',
    'appearMoments: seek times when each person is visible, with a short note of what they are doing.',
    'OBJECTS: name tools, materials, fixtures, and equipment in action object/tool/material fields and in event descriptions when visible.',
    'summary is 3–6 sentences that reconstruct what happened and the situation (who/what/where/why when known). Do not start summary with a timestamp. Do not restate the full event list. Do not begin with "The video shows" or "The camera captures". Mark uncertainty in the summary when needed.',
    'narration is a longer chronological field note covering the whole clip — denser than summary, still only evidenced facts.',
    'events is the Analysis list: one or two present-tense sentences per meaningful change, each tied to a time. No filler ("The video shows", "At N seconds"). Prefix uncertain beats with "Uncertain:" when confidence is low.',
    'Emit an event when something meaningfully changes — scene/room change, new person enters/leaves, object interaction, new activity, camera move to a new subject, work step starts or stops, visible condition change.',
    'Do NOT emit a mandatory event at t=0. An unchanged opening still belongs in summary, not as a catch-all 0-second event. Only emit t=0 when something actually happens at the open.',
    'Do NOT emit events on a fixed cadence (not every 5 seconds, not one row per still). Event-boundary timestamps only — but be thorough: prefer dense precise beats over a thin highlights reel.',
    't_seconds should match a provided frame timestamp. Never invent off-camera work.',
    'type is optional: scene, activity, speech, camera, work, other.',
    'Also list distinct visible actions. Sitting, watching, talking, and pointing at a screen count. Set confidence low (≤0.4) when the still is ambiguous.',
    'action MUST be one of: locate, measure, mark, pick_up, carry, position, align, cut, drill, fasten, apply, connect, test, inspect, remove, clean, protect, correct, wait, watch, talk, other.',
    'atSeconds MUST match a provided frame timestamp.',
    'PRIVACY: when stills show a bathroom/toilet/shower, locker/changing room, explicit undressing, or clearly intimate/private space not meant for work evidence, add privacyRedactions ranges {startSec,endSec,reason,confidence}. Prefer over-redacting private spaces over leaking them. Mark confidence; never invent a private room that is not evidenced. Empty array when nothing private is visible.',
    'CHILD PRIVACY (protective only): when stills show a person who appears to be a minor (child/infant/toddler/teen by appearance), add childPrivacyRedactions ranges {startSec,endSec,reason,confidence,regions?}. ageAppearance on people must be only "child", "adult", or "cannotTell" — NEVER invent names, NEVER reverse-search faces of children, NEVER identify minors. Skip cannotTell. Prefer over-redacting when clearly a child. Optional regions are normalized 0-1 face/body boxes. Empty array when no child is evidenced.',
    'Reply with JSON only: {"narration":"...","summary":"...","people":[{"id":"person-1","label":"Person 1 (crew-like)","role":"crew","appearance":"hard hat, high-vis vest","ageAppearance":"adult","appearMoments":[{"tSec":12,"note":"enters bathroom"}],"speakerLabel":null}],"events":[{"t_seconds":12,"description":"...","type":"scene"}],"actions":[{"atSeconds":number,"action":"watch","room":"office","description":"...","object":"...","tool":"...","material":"...","objects":["..."],"confidence":0.0}],"privacyRedactions":[{"startSec":60,"endSec":95,"reason":"bathroom","confidence":0.85}],"childPrivacyRedactions":[{"startSec":40,"endSec":70,"reason":"child present","confidence":0.85,"regions":[{"x":0.2,"y":0.1,"w":0.15,"h":0.25}]}]}',
    'actions may be an empty array. people may be empty when nobody is visible. events may be empty — prefer an empty events array over a single t=0 dump that restates the summary. privacyRedactions and childPrivacyRedactions may be empty.',
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

  const response = await anthropicClient().messages.stream({
    model: config.technician.assistant.model,
    max_tokens: 12_288,
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
  }).finalMessage();

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
    events: parsed.events,
    people: parsed.people,
    privacyRedactions: parsed.privacyRedactions,
    childPrivacyRedactions: parsed.childPrivacyRedactions,
  };
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
        maxOutputTokens: 16_384,
        // Dense reconstruction on 2.5 Pro / non-lite Flash — thinking helps
        // accuracy without inventing. Lite / unknown ids omit this.
        ...(/^gemini-2\.5/i.test(model) && !/lite/i.test(model)
          ? { thinkingConfig: { thinkingBudget: 8192 } }
          : /^gemini-3/i.test(model)
            ? { thinkingConfig: { thinkingLevel: 'high' } }
            : {}),
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
  return {
    narrationText: parsed.narration,
    narrationSummary: parsed.summary,
    model,
    frameCount: input.frames.length,
    actions: parsed.actions,
    events: parsed.events,
    people: parsed.people,
    privacyRedactions: parsed.privacyRedactions,
    childPrivacyRedactions: parsed.childPrivacyRedactions,
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

function eventsFromParsed(
  data: { events?: unknown; entries?: unknown },
  narration: string,
  actions: VisionAction[],
  frames?: number[],
  summary?: string | null,
): DictationEvent[] {
  const fromModel = parseDictationEvents(data.events ?? data.entries, { frames });
  const raw = fromModel.length
    ? fromModel
    : (() => {
        const fromText = parseTimestampedNarration(narration);
        return fromText.length ? fromText : eventsFromActions(actions);
      })();
  return sanitizeDictationEvents(raw, { summary });
}

/** Exported for tests — dictation JSON must stay parseable without a live model. */
function asPeopleArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === 'object').slice(0, 24);
}

export function parseDictationPayload(
  text: string,
  frames?: number[],
  model?: string | null,
): {
  narration: string;
  summary: string | null;
  actions: VisionAction[];
  events: DictationEvent[];
  people: unknown[];
  privacyRedactions: PrivacyRedactionRange[];
  childPrivacyRedactions: ChildPrivacyRange[];
} {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    const trimmed = text.trim();
    return {
      narration: trimmed,
      summary: null,
      actions: [],
      events: sanitizeDictationEvents(parseTimestampedNarration(trimmed)),
      people: [],
      privacyRedactions: [],
      childPrivacyRedactions: [],
    };
  }
  try {
    const data = JSON.parse(text.slice(start, end + 1)) as {
      narration?: unknown;
      summary?: unknown;
      actions?: unknown;
      events?: unknown;
      entries?: unknown;
      people?: unknown;
      persons?: unknown;
      privacyRedactions?: unknown;
      privacy_redactions?: unknown;
      childPrivacyRedactions?: unknown;
      child_privacy_redactions?: unknown;
    };
    const narration = String(data.narration ?? '').trim();
    const summary = String(data.summary ?? '').trim() || null;
    const actions = parseVisionActions(data.actions, { frames, model: model ?? null });
    return {
      narration,
      summary,
      actions,
      events: eventsFromParsed(data, narration, actions, frames, summary),
      people: asPeopleArray(data.people ?? data.persons),
      privacyRedactions: parsePrivacyRedactions(
        data.privacyRedactions ?? data.privacy_redactions,
      ),
      childPrivacyRedactions: parseChildPrivacyRedactions(
        data.childPrivacyRedactions ?? data.child_privacy_redactions,
      ),
    };
  } catch {
    const trimmed = text.trim();
    return {
      narration: trimmed,
      summary: null,
      actions: [],
      events: sanitizeDictationEvents(parseTimestampedNarration(trimmed)),
      people: [],
      privacyRedactions: [],
      childPrivacyRedactions: [],
    };
  }
}
