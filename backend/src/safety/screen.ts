/**
 * Stage 1 — fast live screen of one 480px frame (+ the latest transcript
 * tail) on the cheap live model (LIVE_OBSERVE_MODEL, Haiku 4.5 today — the
 * same model and cached-prompt pattern as live-observe).
 *
 * High recall, cheap: it only decides whether the confirmation stage should
 * look. It also reports whether a TV / monitor / phone screen is visibly
 * playing — the live media-window signal the confirmation stage uses.
 *
 * Not merged into live-observe's call: that endpoint serves the office's
 * guided-capture loop on a different cadence and client; Field Capture web
 * never calls it. Both share the model config and prompt caching.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SafetyCategory, SafetyFrame, SafetySeverity } from './types.js';
import { safetyProviderOverrides } from './providers.js';

export type ScreenInput = {
  frame: SafetyFrame;
  /** Last ~20 s of live transcript, if any. */
  transcriptTail: string;
};

export type ScreenResult = {
  /** Worth a confirmation look. */
  candidate: boolean;
  category: SafetyCategory | null;
  severity: SafetySeverity | null;
  confidence: number;
  /** A TV / monitor / laptop / phone screen is visibly on and playing. */
  screenPlaying: boolean;
  peopleVisible: number | null;
  note: string;
  model: string;
};

export const SCREEN_SYSTEM = `You screen ONE live frame from a field worker's phone camera (construction / trades / home services) for possible emergencies. You are the fast first stage; a stronger model confirms anything you flag, so lean toward flagging real-looking danger, but do not flag ordinary work.

Flag candidate=true when the frame (or the recent speech) suggests: a person down / fallen / not moving, a struggle or someone being hit or choked, a weapon pointed at someone, someone collapsing or clutching chest, visible serious injury or blood, or speech calling for help / threatening serious harm.
Do not flag: ladders, power tools, normal lifting, mess, someone kneeling to work, calm talk.

Also report screenPlaying=true when a TV, monitor, laptop, tablet or phone screen in the frame is on and showing video / a person talking / a show (YouTube, podcast, news, game, movie). Words heard while a screen is playing may come from that screen.

Reply with JSON only:
{"candidate":boolean,"category":"fall_person_down"|"physical_violence"|"verbal_threat"|"medical_distress"|"other_emergency"|null,"severity":"watch"|"critical"|null,"confidence":number,"screenPlaying":boolean,"peopleVisible":number|null,"note":string}`;

const CATEGORIES: SafetyCategory[] = [
  'fall_person_down',
  'physical_violence',
  'verbal_threat',
  'medical_distress',
  'other_emergency',
];

export function parseScreenJson(text: string, model: string): ScreenResult | null {
  const raw = String(text || '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const confidence = Number(parsed.confidence);
  const people = Number(parsed.peopleVisible);
  return {
    candidate: parsed.candidate === true,
    category: CATEGORIES.includes(parsed.category as SafetyCategory) ? (parsed.category as SafetyCategory) : null,
    severity: parsed.severity === 'critical' || parsed.severity === 'watch' ? (parsed.severity as SafetySeverity) : null,
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
    screenPlaying: parsed.screenPlaying === true,
    peopleVisible: Number.isFinite(people) && people >= 0 ? Math.round(people) : null,
    note: typeof parsed.note === 'string' ? parsed.note.slice(0, 300) : '',
    model,
  };
}

/** One cheap screen call. Null when unconfigured or failed (never throws). */
export async function screenLiveFrame(input: ScreenInput): Promise<ScreenResult | null> {
  const override = safetyProviderOverrides().screen;
  if (override) return override(input);
  const { anthropicClient, isModelProviderConfigured } = await import('../lib/anthropic.js');
  if (!isModelProviderConfigured()) return null;
  const { config } = await import('../config.js');
  const { meterAnthropicResponse } = await import('../metering/backgroundUsage.js');
  const model = config.technician.assistant.liveModel;
  try {
    const response = await anthropicClient().messages.create({
      model,
      max_tokens: 160,
      system: [{ type: 'text', text: SCREEN_SYSTEM, cache_control: { type: 'ephemeral' } }] as any,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Frame at ${Math.round(input.frame.atSeconds)}s. Recent speech: ${
                input.transcriptTail ? JSON.stringify(input.transcriptTail.slice(-600)) : '(none)'
              }`,
            },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: input.frame.base64.replace(/^data:image\/\w+;base64,/, ''),
              },
            },
          ] as any,
        },
      ],
    });
    meterAnthropicResponse('safety_screen', response as any);
    const text = (response.content ?? [])
      .map((block: any) => (block.type === 'text' ? block.text : ''))
      .join('\n');
    return parseScreenJson(text, typeof response.model === 'string' ? response.model : model);
  } catch (err) {
    console.warn('[safety] live screen failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
