/**
 * Stage 2 — "is it really happening?" confirmation.
 *
 * A transcript word list or the fast frame screen only flags a CANDIDATE.
 * This call (the flagship Anthropic model, ANTHROPIC_MODEL — Opus 5 today)
 * looks at several frames from the last ~20 s plus the transcript window and
 * says whether the emergency is real, a joke, staged, or media playing on a
 * TV / monitor / phone (tonight's YouTube podcast "fighting" false alarm).
 *
 * decideFromConfirmation() turns the verdict into an alert decision:
 *   real ≥ threshold            → confirmed alert
 *   unclear (or weak real) + critical → "Unconfirmed: check live view" alert
 *   joking / staged / media_playback → no alert (verdict kept for audit)
 * Atmosphere never dials 911.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { MediaWindow } from '../audio/audioSource.js';
import {
  SAFETY_CONFIRM_MIN_REAL_CRITICAL,
  SAFETY_CONFIRM_MIN_REAL_WATCH,
  SAFETY_REALITIES,
  type SafetyCategory,
  type SafetyClassification,
  type SafetyFrame,
  type SafetyReality,
  type SafetyRecommendedAction,
  type SafetySeverity,
} from './types.js';
import { safetyProviderOverrides } from './providers.js';

export type SafetyCandidate = {
  category: SafetyCategory | null;
  severity: SafetySeverity | null;
  /** What flagged it: the transcript word list, the frame screen, or both. */
  trigger: 'word_list' | 'frame_screen' | 'word_list+frame_screen' | 'vision';
  reason: string;
};

export type SafetyMediaContext = {
  /** Live: frames in the last ~20 s where the screen model saw a playing TV / monitor / phone. */
  screenVisibleFrames?: number;
  screenedFrames?: number;
  /** Post-upload: media windows from the vision narration (existing media tagging). */
  mediaWindows?: MediaWindow[];
  mediaUntimed?: string | null;
  /** Transcript phrasing typical of broadcast / online video. */
  broadcastPhrasing?: boolean;
  note?: string | null;
};

export type ConfirmInput = {
  candidate: SafetyCandidate;
  frames: SafetyFrame[];
  transcriptWindow: string;
  mediaContext: SafetyMediaContext;
  clipTimestampSeconds: number | null;
};

export type ConfirmResult = {
  reality: SafetyReality;
  /** Confidence in the reality verdict (0–1). */
  confidence: number;
  category: SafetyCategory | null;
  severity: SafetySeverity | null;
  title: string;
  description: string;
  cues: string[];
  model: string;
};

export const CONFIRM_MAX_FRAMES = 8;

export const CONFIRM_SYSTEM = `You are the CONFIRMATION stage of a workplace safety system for field crews (construction, trades, home services). A worker's phone is recording. A fast screen (a word list on the live transcript, or a cheap frame check) flagged a POSSIBLE emergency. Your job: decide whether a real emergency is happening to a person physically present, right now.

Answer "reality" with exactly one of:
- "real": a person on site is being hurt, attacked, threatened with serious harm, has fallen / is down, or is in medical distress, now.
- "joking": banter, sarcasm, exaggeration, idioms ("this deadline is killing me", "I'll kill you if you scratch that"), teasing; relaxed tone, laughter, "just kidding", nobody acts alarmed.
- "staged": play-acting, demonstrating, rehearsing, horseplay or a skit with nobody actually hurt.
- "media_playback": the words or images come from a TV, monitor, laptop, tablet, phone, radio, speaker, podcast, YouTube / streaming video, or a phone filming a screen. Signs: a visible screen whose content matches the words; interview / podcast / broadcast cadence; broadcast phrasing; on-screen titles, channel logos, UI chrome; screen bezel, moiré, scan lines, glare; nobody in the room reacting to what is said.
- "unclear": you cannot tell from what you have.

Rules:
1. Words alone are never proof. Violent, medical or fall words inside a story, an interview, a podcast, a song, a game, a recounted past event, or a figure of speech are NOT a real emergency.
2. If a playing screen is visible or the media context says media is playing, and nobody in frame reacts, answer "media_playback".
3. "real" needs corroboration: distress directed at someone present (screaming, "help", "stop", "get off me", calling a name), a fall or impact, someone down or not moving, visible struggle, injury, weapon, or a collapse in the frames.
4. Calm frames of normal work while the transcript has alarming words → not "real".
5. Do not upgrade "unclear" to "real" to be safe — the system already pages "unconfirmed" for high-severity unclear cases.
6. severity "critical" only for possible physical harm to a person (violence, fall / person down, medical distress, credible threat of serious harm); otherwise "watch".
7. Never invent people, injuries or screens you cannot see or read.

Reply with JSON only, no prose:
{"reality":"real"|"joking"|"staged"|"media_playback"|"unclear","confidence":number,"category":"fall_person_down"|"physical_violence"|"verbal_threat"|"medical_distress"|"other_emergency"|null,"severity":"watch"|"critical"|null,"title":string,"description":string,"cues":[string]}`;

const CATEGORIES: SafetyCategory[] = [
  'fall_person_down',
  'physical_violence',
  'verbal_threat',
  'medical_distress',
  'other_emergency',
];

export function describeMediaContext(ctx: SafetyMediaContext): string {
  const lines: string[] = [];
  if (ctx.screenedFrames) {
    lines.push(
      `Frame screen: a playing TV/monitor/phone screen was seen in ${ctx.screenVisibleFrames ?? 0} of the last ${ctx.screenedFrames} frames.`,
    );
  }
  for (const w of (ctx.mediaWindows ?? []).slice(0, 6)) {
    lines.push(
      `Media playing ${Math.round(w.startSeconds)}s–${Math.round(w.endSeconds)}s on a ${w.device}: ${w.evidence}`,
    );
  }
  if (ctx.mediaUntimed) lines.push(`Clip narration mentions playing media: ${ctx.mediaUntimed}`);
  if (ctx.broadcastPhrasing) lines.push('Transcript contains broadcast / online-video phrasing.');
  if (ctx.note) lines.push(ctx.note);
  return lines.length ? lines.join('\n') : 'No playing screen or media was reported.';
}

/** Any independent sign that the words came from a screen / speaker. */
export function hasMediaEvidence(ctx: SafetyMediaContext, atSeconds: number | null): boolean {
  if (ctx.broadcastPhrasing) return true;
  if ((ctx.screenVisibleFrames ?? 0) > 0 && (ctx.screenedFrames ?? 0) > 0) {
    if ((ctx.screenVisibleFrames ?? 0) / (ctx.screenedFrames ?? 1) >= 0.5) return true;
  }
  if (ctx.mediaWindows?.length) {
    if (atSeconds == null) return true;
    if (ctx.mediaWindows.some((w) => atSeconds >= w.startSeconds - 5 && atSeconds <= w.endSeconds + 5)) {
      return true;
    }
  }
  return Boolean(ctx.mediaUntimed && !(ctx.mediaWindows?.length));
}

export function parseConfirmJson(text: string, model: string): ConfirmResult | null {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const reality = String(parsed.reality ?? '') as SafetyReality;
  if (!(SAFETY_REALITIES as readonly string[]).includes(reality)) return null;
  const confidenceRaw = Number(parsed.confidence);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.min(1, Math.max(0, confidenceRaw > 1 && confidenceRaw <= 100 ? confidenceRaw / 100 : confidenceRaw))
    : 0;
  const category = CATEGORIES.includes(parsed.category as SafetyCategory)
    ? (parsed.category as SafetyCategory)
    : null;
  const severity =
    parsed.severity === 'critical' || parsed.severity === 'watch'
      ? (parsed.severity as SafetySeverity)
      : null;
  const title =
    typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim().slice(0, 160) : '';
  const description =
    typeof parsed.description === 'string' && parsed.description.trim()
      ? parsed.description.trim().slice(0, 1500)
      : '';
  const cues = Array.isArray(parsed.cues)
    ? parsed.cues.filter((c): c is string => typeof c === 'string').map((c) => c.slice(0, 200)).slice(0, 8)
    : [];
  return { reality, confidence, category, severity, title, description, cues, model };
}

function stripDataUrl(base64: string): string {
  return base64.replace(/^data:image\/\w+;base64,/, '');
}

/** Evenly pick up to `max` frames, oldest → newest. */
export function pickFrames(frames: SafetyFrame[], max = CONFIRM_MAX_FRAMES): SafetyFrame[] {
  const sorted = [...frames]
    .filter((f) => f && typeof f.base64 === 'string' && f.base64.length >= 80)
    .sort((a, b) => a.atSeconds - b.atSeconds);
  if (sorted.length <= max) return sorted;
  const out: SafetyFrame[] = [];
  for (let i = 0; i < max; i += 1) {
    out.push(sorted[Math.round((i * (sorted.length - 1)) / (max - 1))]!);
  }
  return out;
}

/**
 * Ask the confirmation model. Returns null when no model is configured or the
 * call / reply failed — the caller decides the safe default.
 * Metered in the caller's AI usage scope (video_analysis).
 */
export async function confirmSafetyCandidate(input: ConfirmInput): Promise<ConfirmResult | null> {
  const override = safetyProviderOverrides().confirm;
  if (override) return override(input);

  const { anthropicClient, isModelProviderConfigured } = await import('../lib/anthropic.js');
  if (!isModelProviderConfigured()) return null;
  const { config } = await import('../config.js');
  const { meterAnthropicResponse } = await import('../metering/backgroundUsage.js');
  const frames = pickFrames(input.frames);
  const intro = [
    `Flagged by: ${input.candidate.trigger} — ${input.candidate.reason}`,
    `Suspected: ${input.candidate.category ?? 'unknown'} (${input.candidate.severity ?? 'unknown'} severity)`,
    input.clipTimestampSeconds != null ? `Around ${Math.round(input.clipTimestampSeconds)}s into the recording.` : '',
    '',
    'Media context:',
    describeMediaContext(input.mediaContext),
    '',
    'Transcript window (Whisper, [m:ss] clip time):',
    (input.transcriptWindow || '(no speech heard)').slice(0, 6000),
    '',
    frames.length
      ? `${frames.length} frame(s) follow, oldest first, each labelled with its clip time.`
      : 'No frames are available for this moment.',
  ]
    .filter((line) => line !== null)
    .join('\n');
  const content: any[] = [{ type: 'text', text: intro }];
  for (const frame of frames) {
    content.push({ type: 'text', text: `Frame at ${Math.round(frame.atSeconds)}s:` });
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: stripDataUrl(frame.base64) },
    });
  }
  try {
    const response = await anthropicClient().messages.create({
      model: config.technician.assistant.model,
      max_tokens: 500,
      // Stable instructions first and cached; per-call frames after.
      system: [{ type: 'text', text: CONFIRM_SYSTEM, cache_control: { type: 'ephemeral' } }] as any,
      messages: [{ role: 'user', content }],
    });
    // Billed whether or not the reply parses.
    meterAnthropicResponse('safety_confirm', response as any);
    const text = (response.content ?? [])
      .map((block: any) => (block.type === 'text' ? block.text : ''))
      .join('\n');
    return parseConfirmJson(text, typeof response.model === 'string' ? response.model : config.technician.assistant.model);
  } catch (err) {
    console.warn('[safety] confirmation failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

function actionFor(category: SafetyCategory, severity: SafetySeverity): SafetyRecommendedAction {
  if (severity !== 'critical') return 'monitor';
  return category === 'physical_violence' || category === 'verbal_threat'
    ? 'contact_authorities'
    : 'dispatch_help';
}

const PHYSICAL_HARM: SafetyCategory[] = [
  'fall_person_down',
  'physical_violence',
  'verbal_threat',
  'medical_distress',
];

function label(category: SafetyCategory): string {
  return category.replace(/_/g, ' ');
}

function miss(signals: Record<string, unknown>, reality: SafetyReality | null = null): SafetyClassification {
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
    reality,
    confirmation: null,
  };
}

/**
 * Turn a confirmation verdict into an alert decision. `conf` null means the
 * confirmation model was unavailable: a physical-harm candidate still pages as
 * "Unconfirmed" (safe default) UNLESS there is independent evidence the words
 * came from media — tonight's false alarm had exactly that evidence.
 */
export function decideFromConfirmation(
  conf: ConfirmResult | null,
  candidate: SafetyCandidate,
  opts: { clipTimestampSeconds: number | null; mediaContext: SafetyMediaContext; frameCount?: number },
): SafetyClassification {
  const media = hasMediaEvidence(opts.mediaContext, opts.clipTimestampSeconds);
  const baseSignals: Record<string, unknown> = {
    candidate: true,
    trigger: candidate.trigger,
    triggerReason: candidate.reason.slice(0, 400),
    mediaEvidence: media,
    framesChecked: opts.frameCount ?? 0,
  };
  const category = conf?.category ?? candidate.category;
  const severity = conf?.severity ?? candidate.severity;

  if (!conf) {
    if (media) return miss({ ...baseSignals, reason: 'unconfirmed_media_evidence' }, 'media_playback');
    if (category && severity === 'critical' && PHYSICAL_HARM.includes(category)) {
      return {
        hit: true,
        category,
        severity: 'critical',
        confidence: 0.5,
        title: `Unconfirmed: check live view — possible ${label(category)}`,
        description: `Flagged by ${candidate.trigger}; the confirmation check could not run. ${candidate.reason}`.slice(0, 4000),
        recommendedAction: actionFor(category, 'critical'),
        clipTimestampSeconds: opts.clipTimestampSeconds,
        model: null,
        signals: { ...baseSignals, reason: 'confirmation_unavailable' },
        reality: 'unclear',
        confirmation: 'unconfirmed',
      };
    }
    return miss({ ...baseSignals, reason: 'confirmation_unavailable' });
  }

  const signals = {
    ...baseSignals,
    reality: conf.reality,
    realityConfidence: conf.confidence,
    cues: conf.cues,
    confirmModel: conf.model,
  };

  if (conf.reality === 'joking' || conf.reality === 'staged' || conf.reality === 'media_playback') {
    return miss({ ...signals, reason: `not_real_${conf.reality}` }, conf.reality);
  }
  if (!category || !severity) return miss({ ...signals, reason: 'no_category' }, conf.reality);

  const min = severity === 'critical' ? SAFETY_CONFIRM_MIN_REAL_CRITICAL : SAFETY_CONFIRM_MIN_REAL_WATCH;
  if (conf.reality === 'real' && conf.confidence >= min) {
    const title = conf.title || `Possible ${label(category)}`;
    return {
      hit: true,
      category,
      severity,
      confidence: conf.confidence,
      title,
      description: conf.description || title,
      recommendedAction: actionFor(category, severity),
      clipTimestampSeconds: opts.clipTimestampSeconds,
      model: conf.model,
      signals: { ...signals, reason: 'confirmed_real' },
      reality: 'real',
      confirmation: 'confirmed',
    };
  }

  // unclear, or "real" below the threshold: only physical harm at critical
  // severity pages, and it says so ("Unconfirmed: check live view").
  if (severity === 'critical' && PHYSICAL_HARM.includes(category)) {
    const what = conf.title || `possible ${label(category)}`;
    return {
      hit: true,
      category,
      severity: 'critical',
      confidence: conf.confidence,
      title: `Unconfirmed: check live view — ${what}`.slice(0, 200),
      description: conf.description || `The check could not confirm whether this is real. Open the live view.`,
      recommendedAction: actionFor(category, 'critical'),
      clipTimestampSeconds: opts.clipTimestampSeconds,
      model: conf.model,
      signals: { ...signals, reason: conf.reality === 'real' ? 'real_below_threshold' : 'unclear_high_severity' },
      reality: conf.reality,
      confirmation: 'unconfirmed',
    };
  }
  return miss({ ...signals, reason: conf.reality === 'real' ? 'real_below_threshold' : 'unclear_low_severity' }, conf.reality);
}
