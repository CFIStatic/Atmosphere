/**
 * High-precision safety classification for Field Capture chunks.
 *
 * Layers:
 *   1. Deterministic transcript word list (fast, no model). A match is only a
 *      CANDIDATE — words alone never page anyone (tonight's YouTube podcast
 *      "fighting" false alarm). Long transcripts are scanned in windows.
 *   2. Confirmation (confirm.ts): a model looks at the transcript window, the
 *      media context (existing media-window tagging, visible screens) and
 *      frames, and answers real / joking / staged / media_playback / unclear.
 *   3. Vision over sparse JPEG frames, which reports the same reality field.
 *
 * Bias: prefer false negatives, except physical harm that the model cannot
 * rule out, which pages as "Unconfirmed: check live view".
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
import {
  confirmSafetyCandidate,
  decideFromConfirmation,
  describeMediaContext,
  pickFrames,
  type SafetyMediaContext,
} from './confirm.js';

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
  /**
   * When false, skip every model (tests / offline). A word-list candidate is
   * then decided as "confirmation unavailable" (unconfirmed for physical harm,
   * unless media evidence says it came from a screen).
   */
  allowModel?: boolean;
  /** Server-side media signals (never taken from the client). */
  mediaContext?: SafetyMediaContext;
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
    model: 'word_list',
    // A word-list match is a candidate for the confirmation model, never an alert.
    signals: { ...signals, candidate: true },
  };
}

/**
 * Word list over transcript text: flags a CANDIDATE only (see confirm.ts).
 * Exported for tests.
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
5. Say whether what you see is really happening — "reality":
   - "real": happening to a person physically present, now.
   - "joking": horseplay, teasing, exaggerated play with nobody hurt.
   - "staged": acting, demonstrating, rehearsing, posing.
   - "media_playback": it is on a TV / monitor / laptop / phone screen (or a phone filming a screen): bezel, UI chrome, channel logos, titles, moiré or scan lines, glare, nobody in the room reacting.
   - "unclear": you cannot tell.
   Use the media context below (screens seen playing, narration) as evidence.
6. Reply with JSON only:
{"hit":boolean,"reality":"real"|"joking"|"staged"|"media_playback"|"unclear","realityCues":[string],"category":"fall_person_down"|"physical_violence"|"medical_distress"|"other_emergency"|null,"severity":"watch"|"critical"|null,"confidence":number,"title":string|null,"description":string|null,"clipTimestampSeconds":number|null}`;

const REALITY_VALUES = ['real', 'joking', 'staged', 'media_playback', 'unclear'];

function parseVisionJson(text: string): SafetyClassification | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return null;
  }
  const reality = REALITY_VALUES.includes(String(parsed.reality))
    ? (String(parsed.reality) as SafetyClassification['reality'])
    : null;
  if (parsed.hit !== true) return emptyMiss({ vision: parsed, reason: 'model_miss', reality });

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
  const cues = Array.isArray(parsed.realityCues)
    ? parsed.realityCues.filter((c): c is string => typeof c === 'string').slice(0, 6)
    : [];
  // Joking / staged / a screen playing: seen, recorded, never paged.
  if (reality === 'joking' || reality === 'staged' || reality === 'media_playback') {
    return { ...emptyMiss({ reason: `not_real_${reality}`, category, severity, confidence, cues }), reality };
  }
  const min =
    severity === 'critical' ? SAFETY_MIN_CONFIDENCE_CRITICAL : SAFETY_MIN_CONFIDENCE_WATCH;
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
  const confirmed = reality === 'real' && confidence >= min;
  if (!confirmed) {
    // Unclear (or a reply without the reality field): only critical physical
    // harm pages, as "Unconfirmed: check live view".
    if (severity !== 'critical') {
      return emptyMiss({ reason: 'below_threshold_or_unclear', confidence, category, severity, reality });
    }
    return {
      hit: true,
      category,
      severity,
      confidence: Math.min(1, Math.max(0, confidence)),
      title: `Unconfirmed: check live view — ${title}`.slice(0, 200),
      description,
      recommendedAction: actionFor(category, severity),
      clipTimestampSeconds: clipTs,
      model: null,
      signals: { vision: true, reality: reality ?? 'unclear', cues },
      reality: reality ?? 'unclear',
      confirmation: 'unconfirmed',
    };
  }
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
    signals: { vision: true, reality, cues },
    reality: 'real',
    confirmation: 'confirmed',
  };
}

async function classifyWithVision(
  frames: SafetyFrame[],
  clipTimestampSeconds: number | null,
  mediaContext?: SafetyMediaContext,
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
  parts.push(`Media context: ${describeMediaContext(mediaContext ?? {})}`);
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
      const { resolveAnthropicModel } = await import('../lib/anthropicModel.js');
      const response = await anthropicClient().messages.create({
        model: resolveAnthropicModel(process.env.ANTHROPIC_MODEL),
        max_tokens: 600,
        system: VISION_SYSTEM,
        messages: [{ role: 'user', content: content as any }],
      });
      const { meterAnthropicResponse } = await import('../metering/backgroundUsage.js');
      meterAnthropicResponse('safety_vision', response);
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
      meterSource: 'safety_text',
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
 * Classify a live / chunk safety sample.
 *
 * A word-list match is a candidate: the confirmation model decides (frames +
 * transcript window + media context). Without a word-list match, frames go to
 * the vision check, which reports reality itself.
 */
export async function classifySafetySample(
  input: ClassifySafetyInput,
): Promise<SafetyClassification> {
  const clipTs =
    input.clipTimestampSeconds != null && Number.isFinite(input.clipTimestampSeconds)
      ? Number(input.clipTimestampSeconds)
      : null;
  const mediaContext = input.mediaContext ?? {};
  const frames = (input.frames ?? []).filter(
    (f) => f && typeof f.base64 === 'string' && f.base64.length >= 80,
  );

  const fromText = classifySafetyFromTranscript(input.transcriptSnippet, clipTs);
  if (fromText.hit && fromText.category && fromText.severity) {
    const candidate = {
      category: fromText.category,
      severity: fromText.severity,
      trigger: 'word_list' as const,
      reason: `word list: ${String(fromText.signals.rule ?? fromText.category)}`,
    };
    const conf =
      input.allowModel === false
        ? null
        : await confirmSafetyCandidate({
            candidate,
            frames: pickFrames(frames),
            transcriptWindow: String(input.transcriptSnippet ?? ''),
            mediaContext,
            clipTimestampSeconds: clipTs,
          });
    const decided = decideFromConfirmation(conf, candidate, {
      clipTimestampSeconds: clipTs,
      mediaContext,
      frameCount: frames.length,
    });
    return {
      ...decided,
      signals: { ...decided.signals, wordList: fromText.signals },
    };
  }

  if (input.allowModel === false) {
    return emptyMiss({ reason: 'model_disabled', prior: fromText.signals });
  }

  if (!frames.length) return emptyMiss({ reason: 'no_signal' });

  return classifyWithVision(frames, clipTs, mediaContext);
}

export type TranscriptCandidateWindow = {
  /** Clip seconds of the matching line (null when the text has no clock). */
  atSeconds: number | null;
  /** The match plus ~30 s of context either side. */
  text: string;
  category: SafetyCategory;
};

type TimedLine = { start: number; end: number; text: string };

function stampOf(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `[${h}:${String(m).padStart(2, '0')}:${sec}]` : `[${m}:${sec}]`;
}

/** Parse "[m:ss] text" / "[h:mm:ss] text" lines from a stamped transcript. */
function linesFromStampedText(text: string): TimedLine[] {
  const out: TimedLine[] = [];
  for (const raw of String(text || '').split(/\n+/)) {
    const m = raw.match(/^\s*\[(?:(\d+):)?(\d{1,2}):(\d{2})\]\s*(.*)$/);
    if (!m) continue;
    const start = Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    out.push({ start, end: start, text: m[4] ?? '' });
  }
  for (let i = 0; i < out.length; i += 1) out[i]!.end = out[i + 1]?.start ?? out[i]!.start + 10;
  return out;
}

/**
 * Scan the WHOLE transcript (not the first 2,000 characters) with the word
 * list and return one ±30 s window per distinct candidate moment. Windows
 * closer than `mergeSeconds` merge; at most `maxWindows` are returned.
 */
export function transcriptCandidateWindows(input: {
  segments?: TimedLine[] | null;
  text?: string | null;
  contextSeconds?: number;
  mergeSeconds?: number;
  maxWindows?: number;
}): TranscriptCandidateWindow[] {
  const context = input.contextSeconds ?? 30;
  const merge = input.mergeSeconds ?? 45;
  const max = input.maxWindows ?? 6;
  let lines: TimedLine[] = (input.segments ?? [])
    .filter((s) => s && typeof s.text === 'string' && Number.isFinite(Number(s.start)))
    .map((s) => ({ start: Number(s.start), end: Number(s.end ?? s.start), text: s.text }));
  if (!lines.length) lines = linesFromStampedText(input.text ?? '');
  const out: TranscriptCandidateWindow[] = [];

  if (!lines.length) {
    // No clock at all: overlapping 2,000-character windows over the full text.
    const text = String(input.text ?? '');
    for (let start = 0; start < text.length && out.length < max; start += 1600) {
      const chunk = text.slice(start, start + 2000);
      const hit = classifySafetyFromTranscript(chunk, null);
      if (hit.hit && hit.category) out.push({ atSeconds: null, text: chunk, category: hit.category });
    }
    return out;
  }

  lines.sort((a, b) => a.start - b.start);
  let lastAt = -Infinity;
  for (let i = 0; i < lines.length && out.length < max; i += 1) {
    let hit = classifySafetyFromTranscript(lines[i]!.text, lines[i]!.start);
    let at = lines[i]!.start;
    const next = lines[i + 1];
    if (!hit.hit && next && !classifySafetyFromTranscript(next.text, next.start).hit) {
      // A phrase split across two segments: it completes on the next line.
      hit = classifySafetyFromTranscript(`${lines[i]!.text} ${next.text}`, next.start);
      at = next.start;
    }
    if (!hit.hit || !hit.category) continue;
    if (at - lastAt < merge) continue;
    lastAt = at;
    const text = lines
      .filter((l) => l.end >= at - context && l.start <= at + context)
      .map((l) => `${stampOf(l.start)} ${l.text.trim()}`)
      .join('\n');
    out.push({ atSeconds: at, text: text.slice(0, 6000), category: hit.category });
  }
  return out;
}
