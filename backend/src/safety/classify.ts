/**
 * High-precision safety classification for Field Capture chunks.
 *
 * Two layers:
 *   1. Deterministic transcript / cue heuristics (fast, no model) — verbal
 *      threats and obvious distress phrases when a mid-stream transcript exists.
 *   2. Optional vision LLM over sparse JPEG frames when a provider is configured.
 *
 * Bias: prefer false negatives. Ambiguous footage returns hit=false.
 */

import { completeAskText, isAskModelConfigured } from '../lib/askModel.js';
import {
  SAFETY_MIN_CONFIDENCE_CRITICAL,
  SAFETY_MIN_CONFIDENCE_WATCH,
  type SafetyCategory,
  type SafetyClassification,
  type SafetyFrame,
  type SafetyRecommendedAction,
  type SafetySeverity,
} from './types.js';

const VERBAL_THREAT =
  /\b((i('ll| will) (kill|hurt|stab|shoot)|kill you|gun(ned)?|knife|beat (you|him|her) (up|to)|i('m| am) going to (hurt|kill)|threaten(ing)?|hostage)\b)/i;

const MEDICAL_DISTRESS =
  /\b(can('t| not) breathe|heart attack|stroke|overdose|unconscious|not breathing|chest pain|seizure|call (911|an ambulance)|need (an )?ambulance)\b/i;

const FALL_CUES =
  /\b(fell (down|off|over)|i fell|he fell|she fell|person down|man down|help me up|can('t| not) get up|hit (my|his|her) head)\b/i;

const VIOLENCE_CUES =
  /\b(punch(ed|ing)?|assault|attack(ed|ing)?|fighting|beat(ing)? (him|her|me)|chok(e|ing)|hit me|hitting (him|her|me))\b/i;

export type ClassifySafetyInput = {
  frames?: SafetyFrame[];
  transcriptSnippet?: string | null;
  clipTimestampSeconds?: number | null;
  /** When false, skip the LLM and use heuristics only (tests / offline). */
  allowModel?: boolean;
};

function emptyMiss(signals: Record<string, unknown> = {}): SafetyClassification {
  return {
    hit: false,
    category: null,
    severity: null,
    confidence: 0,
    title: null,
    description: null,
    recommendedAction: 'monitor',
    clipTimestampSeconds: null,
    model: null,
    signals,
  };
}

function actionFor(
  category: SafetyCategory,
  severity: SafetySeverity,
): SafetyRecommendedAction {
  if (severity === 'critical') {
    if (category === 'physical_violence' || category === 'verbal_threat') {
      return 'contact_authorities';
    }
    return 'dispatch_help';
  }
  return 'monitor';
}

function fromHeuristic(
  category: SafetyCategory,
  severity: SafetySeverity,
  confidence: number,
  title: string,
  description: string,
  clipTimestampSeconds: number | null,
  signals: Record<string, unknown>,
): SafetyClassification {
  const min =
    severity === 'critical' ? SAFETY_MIN_CONFIDENCE_CRITICAL : SAFETY_MIN_CONFIDENCE_WATCH;
  if (confidence < min) return emptyMiss({ ...signals, belowThreshold: true, confidence });
  return {
    hit: true,
    category,
    severity,
    confidence,
    title,
    description,
    recommendedAction: actionFor(category, severity),
    clipTimestampSeconds,
    model: 'heuristic',
    signals,
  };
}

/**
 * Fast path: transcript / spoken cues only. Exported for tests.
 */
export function classifySafetyFromTranscript(
  text: string | null | undefined,
  clipTimestampSeconds: number | null = null,
): SafetyClassification {
  const snippet = (text ?? '').trim();
  if (!snippet) return emptyMiss({ reason: 'empty_transcript' });

  if (VERBAL_THREAT.test(snippet)) {
    return fromHeuristic(
      'verbal_threat',
      'critical',
      0.9,
      'Verbal threat of serious harm',
      `Transcript cue: ${snippet.slice(0, 280)}`,
      clipTimestampSeconds,
      { rule: 'verbal_threat', snippet: snippet.slice(0, 400) },
    );
  }
  if (MEDICAL_DISTRESS.test(snippet)) {
    return fromHeuristic(
      'medical_distress',
      'critical',
      0.88,
      'Possible medical distress',
      `Transcript cue: ${snippet.slice(0, 280)}`,
      clipTimestampSeconds,
      { rule: 'medical_distress', snippet: snippet.slice(0, 400) },
    );
  }
  if (FALL_CUES.test(snippet)) {
    return fromHeuristic(
      'fall_person_down',
      'critical',
      0.86,
      'Possible fall / person down',
      `Transcript cue: ${snippet.slice(0, 280)}`,
      clipTimestampSeconds,
      { rule: 'fall_person_down', snippet: snippet.slice(0, 400) },
    );
  }
  if (VIOLENCE_CUES.test(snippet)) {
    return fromHeuristic(
      'physical_violence',
      'critical',
      0.87,
      'Possible physical violence',
      `Transcript cue: ${snippet.slice(0, 280)}`,
      clipTimestampSeconds,
      { rule: 'physical_violence', snippet: snippet.slice(0, 400) },
    );
  }
  return emptyMiss({ reason: 'no_transcript_match' });
}

const VISION_SYSTEM = `You are a SAFETY classifier for construction Field Capture video frames.
Your ONLY job is to detect clear emergencies that an office should act on RIGHT NOW:
- fall / person down / unresponsive on the floor
- physical violence / assault (hitting, choking, weapon)
- medical distress that is obvious in the frames (collapse, seizure, severe injury)
- other clear emergency requiring immediate help

Rules (precision over recall):
1. Return hit=false unless the emergency is CLEARLY visible. Ambiguous or ordinary work footage must be a miss.
2. Do not flag ladders, normal lifting, tools, or mild arguing.
3. Prefer severity "watch" when unsure between watch and critical; use "critical" only for clear life-safety risk.
4. Never invent rooms, people, or injuries you cannot see.
5. Reply with JSON only:
{"hit":boolean,"category":"fall_person_down"|"physical_violence"|"medical_distress"|"other_emergency"|null,"severity":"watch"|"critical"|null,"confidence":number,"title":string|null,"description":string|null,"clipTimestampSeconds":number|null}`;

function parseVisionJson(text: string): SafetyClassification | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (parsed.hit !== true) return emptyMiss({ vision: parsed, reason: 'model_miss' });

  const category = parsed.category as SafetyCategory | null;
  const severity = parsed.severity as SafetySeverity | null;
  const confidence = Number(parsed.confidence);
  if (
    !category ||
    !severity ||
    !Number.isFinite(confidence) ||
    !['fall_person_down', 'physical_violence', 'medical_distress', 'other_emergency'].includes(
      category,
    ) ||
    !['watch', 'critical'].includes(severity)
  ) {
    return emptyMiss({ reason: 'malformed_vision', parsed });
  }
  const min =
    severity === 'critical' ? SAFETY_MIN_CONFIDENCE_CRITICAL : SAFETY_MIN_CONFIDENCE_WATCH;
  if (confidence < min) {
    return emptyMiss({ reason: 'below_threshold', confidence, category, severity });
  }
  const title =
    typeof parsed.title === 'string' && parsed.title.trim()
      ? parsed.title.trim().slice(0, 200)
      : `Safety: ${category.replace(/_/g, ' ')}`;
  const description =
    typeof parsed.description === 'string' && parsed.description.trim()
      ? parsed.description.trim().slice(0, 4000)
      : title;
  const clipTs =
    typeof parsed.clipTimestampSeconds === 'number' && Number.isFinite(parsed.clipTimestampSeconds)
      ? parsed.clipTimestampSeconds
      : null;
  return {
    hit: true,
    category,
    severity,
    confidence: Math.min(1, Math.max(0, confidence)),
    title,
    description,
    recommendedAction: actionFor(category, severity),
    clipTimestampSeconds: clipTs,
    model: null,
    signals: { vision: true },
  };
}

async function classifyWithVision(
  frames: SafetyFrame[],
  clipTimestampSeconds: number | null,
): Promise<SafetyClassification> {
  if (!frames.length || !isAskModelConfigured()) {
    return emptyMiss({ reason: frames.length ? 'model_unconfigured' : 'no_frames' });
  }
  const picked = frames.slice(0, 3);
  const parts: string[] = [
    `Classify these ${picked.length} Field Capture frame(s) for emergencies only.`,
  ];
  if (clipTimestampSeconds != null) {
    parts.push(`Approximate clip timestamp: ${clipTimestampSeconds}s.`);
  }
  // Ask text path cannot take images on every provider; encode a compact
  // description hint and rely on transcript heuristics when vision transport
  // is unavailable. When Anthropic is configured, include image blocks via a
  // short caption of frame timestamps so the model still gets structure.
  for (const frame of picked) {
    parts.push(
      `Frame at ${frame.atSeconds}s (jpeg base64 length ${frame.base64.length}). ` +
        `If you cannot see pixels, return hit=false.`,
    );
  }
  // Prefer a dedicated vision call when Anthropic is present.
  try {
    const { anthropicClient, isModelProviderConfigured } = await import('../lib/anthropic.js');
    if (isModelProviderConfigured()) {
      const content: Array<Record<string, unknown>> = [
        { type: 'text', text: parts.join('\n') },
        ...picked.map((frame) => ({
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/jpeg',
            data: frame.base64.replace(/^data:image\/\w+;base64,/, ''),
          },
        })),
      ];
      const response = await anthropicClient().messages.create({
        model: process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-4-20250514',
        max_tokens: 600,
        system: VISION_SYSTEM,
        messages: [{ role: 'user', content: content as any }],
      });
      const text = response.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('\n')
        .trim();
      const parsed = parseVisionJson(text);
      if (parsed) {
        return {
          ...parsed,
          model: typeof response.model === 'string' ? response.model : 'anthropic',
          clipTimestampSeconds: parsed.clipTimestampSeconds ?? clipTimestampSeconds,
        };
      }
    }
  } catch (err) {
    // Fall through to text-only Ask — still prefer miss over crash.
    console.warn(
      '[safety] vision classify failed:',
      err instanceof Error ? err.message : err,
    );
  }

  // Text-only fallback cannot see pixels → miss (precision bias).
  if (!isAskModelConfigured()) return emptyMiss({ reason: 'vision_unavailable' });
  try {
    const result = await completeAskText({
      system: VISION_SYSTEM,
      user: `${parts.join('\n')}\nNo pixel data available in this fallback — return hit=false.`,
      mode: 'analysis',
      maxTokens: 400,
    });
    if (!result) return emptyMiss({ reason: 'ask_empty' });
    const parsed = parseVisionJson(result.text);
    if (parsed?.hit) {
      // Text fallback claiming a hit without pixels is not trusted.
      return emptyMiss({ reason: 'text_fallback_hit_rejected' });
    }
    return emptyMiss({ reason: 'text_fallback_miss', model: result.model });
  } catch {
    return emptyMiss({ reason: 'ask_failed' });
  }
}

/**
 * Classify a live / chunk safety sample. Transcript heuristics run first;
 * vision only if heuristics miss and frames are present.
 */
export async function classifySafetySample(
  input: ClassifySafetyInput,
): Promise<SafetyClassification> {
  const clipTs =
    input.clipTimestampSeconds != null && Number.isFinite(input.clipTimestampSeconds)
      ? Number(input.clipTimestampSeconds)
      : null;

  const fromText = classifySafetyFromTranscript(input.transcriptSnippet, clipTs);
  if (fromText.hit) return fromText;

  if (input.allowModel === false) {
    return emptyMiss({ reason: 'model_disabled', prior: fromText.signals });
  }

  const frames = (input.frames ?? []).filter(
    (f) => f && typeof f.base64 === 'string' && f.base64.length >= 80,
  );
  if (!frames.length) return emptyMiss({ reason: 'no_signal' });

  const vision = await classifyWithVision(frames, clipTs);
  return vision;
}
