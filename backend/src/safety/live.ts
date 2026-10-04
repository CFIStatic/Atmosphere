/**
 * Live safety stream (Phase 1 + 2): alert while it is happening, not at upload.
 *
 * While Field Capture web records it POSTs, every 5 s, one 480px frame and,
 * every 10 s, the last 10-second audio segment. Per clip the server keeps a
 * rolling context (60 s of transcript, 20 s of frames + screen verdicts) and:
 *
 *   1. Whisper on each audio segment            → transcript lines
 *   2. word list on the new lines (+ neighbour)  → candidate
 *   3. fast frame screen (Haiku, cached prompt)  → candidate + "screen playing"
 *   4. ONLY when 2 or 3 fires: confirmation (Opus) over 6–8 frames from the
 *      last 20 s + the 60 s transcript window + the media signals →
 *      real / joking / staged / media_playback / unclear
 *   5. real ≥ threshold → alert; critical unclear → "Unconfirmed: check live
 *      view" alert; joking / staged / media → no alert.
 *
 * Every model call runs in a video_analysis metering scope; Whisper segments
 * are recorded as flat video_analysis fees. Per-org opt-out
 * (orgs.safety_live_enabled, default ON).
 *
 * The context lives in this process's memory (one API instance today). With
 * several instances a clip's chunks would need sticky routing or a shared
 * store; the alert itself is durable (safety_incidents + email).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';
import { runWithAiUsageScope } from '../metering/aiUsageContext.js';
import { VIDEO_ANALYSIS_FEATURE } from '../metering/backgroundUsage.js';
import { assertOrgProductActionsAllowed } from '../lib/paidWorkspace.js';
import { soundsLikeBroadcast } from '../audio/audioSource.js';
import { classifySafetyFromTranscript } from './classify.js';
import {
  confirmSafetyCandidate,
  decideFromConfirmation,
  pickFrames,
  type SafetyCandidate,
  type SafetyMediaContext,
} from './confirm.js';
import { screenLiveFrame, type ScreenResult } from './screen.js';
import { createSafetyIncident } from './incidents.js';
import { fanoutSafetyAlert } from './alerts.js';
import { loadOrgSafetySettings } from './settings.js';
import { safetyProviderOverrides, type LiveTranscribeResult } from './providers.js';
import type { SafetyFrame, SafetyIncident, SafetyReality } from './types.js';

export const LIVE_TRANSCRIPT_CONTEXT_SECONDS = 60;
export const LIVE_FRAME_CONTEXT_SECONDS = 20;
/** Screen verdict confidence needed to call the confirmation stage. */
export const LIVE_SCREEN_MIN_CONFIDENCE = 0.4;
/** Do not re-confirm the same clip more often than this without a new trigger. */
export const LIVE_CONFIRM_COOLDOWN_MS = 8_000;
/** After a "not real" verdict (media / joking / staged), wait longer. */
export const LIVE_CONFIRM_NOT_REAL_COOLDOWN_MS = 45_000;
/** Cost ceiling: confirmations per clip per rolling hour. */
export const LIVE_CONFIRM_MAX_PER_HOUR = 40;

export const liveSafetySchema = z.object({
  clipId: z.string().regex(/^[a-zA-Z0-9_-]{6,64}$/),
  seq: z.number().int().min(0).max(10_000_000),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  phase: z.enum(['before', 'after']).optional(),
  frame: z
    .object({
      atSeconds: z.number().min(0).max(86_400),
      base64: z.string().min(80).max(350_000),
    })
    .optional(),
  audio: z
    .object({
      startSeconds: z.number().min(0).max(86_400),
      durationSeconds: z.number().min(0.3).max(15),
      mimeType: z.string().regex(/^audio\/(webm|mp4|ogg|mpeg|wav|x-m4a|aac|m4a)(;.*)?$/i),
      base64: z.string().min(40).max(1_400_000),
    })
    .optional(),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  locationLabel: z.string().max(400).optional(),
});

type Line = { start: number; end: number; text: string };
type ScreenMark = { atSeconds: number; screenPlaying: boolean; candidate: boolean };

type ClipState = {
  key: string;
  frames: SafetyFrame[];
  lines: Line[];
  screens: ScreenMark[];
  latestSeconds: number;
  confirming: boolean;
  lastConfirmAtMs: number;
  lastTrigger: string | null;
  lastReality: SafetyReality | null;
  confirmTimes: number[];
  lastSeenMs: number;
  alert: LiveAlert | null;
};

export type LiveAlert = {
  incidentId: string;
  confirmation: 'confirmed' | 'unconfirmed' | null;
  severity: string;
  title: string;
};

export type LiveSafetyResult = {
  enabled: boolean;
  /** A word list or the frame screen flagged this chunk. */
  screened: boolean;
  /** Confirmation ran on this chunk. */
  confirmed: boolean;
  reality: SafetyReality | null;
  alert: LiveAlert | null;
  /** True when another chunk's confirmation is already running. */
  pending: boolean;
  heard: string | null;
  serverMs: number;
  timings: Record<string, number>;
};

const MAX_CLIPS = 1000;
const IDLE_MS = 15 * 60 * 1000;
const clips = new Map<string, ClipState>();

export function resetLiveSafetyForTests(): void {
  clips.clear();
}

function clipState(key: string, now: number): ClipState {
  let state = clips.get(key);
  if (!state) {
    if (clips.size >= MAX_CLIPS) {
      for (const [k, v] of clips) {
        if (now - v.lastSeenMs > IDLE_MS || clips.size >= MAX_CLIPS) clips.delete(k);
        if (clips.size < MAX_CLIPS * 0.9) break;
      }
    }
    state = {
      key,
      frames: [],
      lines: [],
      screens: [],
      latestSeconds: 0,
      confirming: false,
      lastConfirmAtMs: 0,
      lastTrigger: null,
      lastReality: null,
      confirmTimes: [],
      lastSeenMs: now,
      alert: null,
    };
    clips.set(key, state);
  }
  state.lastSeenMs = now;
  return state;
}

function prune(state: ClipState): void {
  const t = state.latestSeconds;
  state.lines = state.lines.filter((l) => l.end >= t - LIVE_TRANSCRIPT_CONTEXT_SECONDS).slice(-60);
  state.frames = state.frames.filter((f) => f.atSeconds >= t - LIVE_FRAME_CONTEXT_SECONDS).slice(-12);
  state.screens = state.screens.filter((s) => s.atSeconds >= t - LIVE_FRAME_CONTEXT_SECONDS).slice(-12);
}

function stamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `[${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}]`;
}

export function transcriptWindowText(lines: Line[]): string {
  return [...lines]
    .sort((a, b) => a.start - b.start)
    .map((l) => `${stamp(l.start)} ${l.text.trim()}`)
    .join('\n');
}

async function transcribeSegment(
  admin: any,
  party: { org_id: string; job_id: string },
  clipId: string,
  seq: number,
  audio: NonNullable<z.infer<typeof liveSafetySchema>['audio']>,
): Promise<LiveTranscribeResult | null> {
  const bytes = Buffer.from(audio.base64, 'base64');
  if (bytes.length < 200) return null;
  const overrides = safetyProviderOverrides();
  const mime = audio.mimeType.split(';')[0]!.toLowerCase();
  let attempted = false;
  try {
    if (overrides.transcribe) {
      attempted = true;
      return await overrides.transcribe(bytes, mime, audio.startSeconds);
    }
    const { transcribeAudioTimed } = await import('../lib/transcription.js');
    const { config } = await import('../config.js');
    if (!config.technician.transcription.url) return null;
    attempted = true;
    const timed = await transcribeAudioTimed(bytes, mime, { timeOffsetSeconds: audio.startSeconds });
    return { text: timed.text, segments: timed.segments };
  } catch (err) {
    if ((err as any)?.code !== 'transcription_empty') {
      console.warn('[safety] live whisper failed:', err instanceof Error ? err.message : err);
    }
    return null;
  } finally {
    // Whisper bills the audio it was sent, heard or not: one flat
    // video_analysis fee per segment at the shared per-minute price.
    if (attempted) meterWhisperSegment(admin, party, clipId, seq, audio.durationSeconds);
  }
}

function meterWhisperSegment(
  admin: any,
  party: { org_id: string; job_id: string },
  clipId: string,
  seq: number,
  seconds: number,
): void {
  // Read the sink now: the fee belongs to this call, not whatever is set later.
  const sink = safetyProviderOverrides().meterFlat;
  void (async () => {
    const { modelPriceTable, transcriptionCostNanos } = await import('../metering/modelPriceTable.js');
    const { resolveTranscriptionConfig } = await import('../lib/transcriptionConfig.js');
    const model = resolveTranscriptionConfig().model;
    const row = {
      orgId: party.org_id,
      requestId: `whisper_live:${clipId}:${seq}`,
      feature: VIDEO_ANALYSIS_FEATURE,
      source: 'whisper_live_safety',
      modelId: model,
      costNanos: transcriptionCostNanos(modelPriceTable(), model, seconds) ?? 0,
      jobId: party.job_id,
      provider: 'openai',
      metadata: { audioSeconds: seconds, clipId, seq },
    };
    if (sink) {
      sink(row);
      return;
    }
    const { recordFlatProviderCost } = await import('../metering/tokenUsage.js');
    recordFlatProviderCost(admin, row);
  })().catch((err) => {
    console.error('[metering] live whisper fee not recorded', err instanceof Error ? err.message : err);
  });
}

function mediaContextOf(state: ClipState, windowText: string): SafetyMediaContext {
  const screened = state.screens.length;
  const playing = state.screens.filter((s) => s.screenPlaying).length;
  return {
    screenedFrames: screened,
    screenVisibleFrames: playing,
    broadcastPhrasing: soundsLikeBroadcast(windowText),
  };
}

/**
 * One live chunk: a frame, an audio segment, or both. Resolves after the
 * screen (and, when it fires, the confirmation and the alert fanout) so the
 * phone can show "Alert sent, tap I'm OK" — the alert never waits on that tap.
 */
export async function processLiveSafetyChunk(
  admin: any,
  party: { org_id: string; job_id: string; id: string },
  body: unknown,
): Promise<LiveSafetyResult> {
  const t0 = Date.now();
  const timings: Record<string, number> = {};
  const input = liveSafetySchema.parse(body ?? {});
  await assertOrgProductActionsAllowed(admin, party.org_id);
  const settings = await loadOrgSafetySettings(admin, party.org_id);
  const base: LiveSafetyResult = {
    enabled: settings.liveSafetyEnabled,
    screened: false,
    confirmed: false,
    reality: null,
    alert: null,
    pending: false,
    heard: null,
    serverMs: 0,
    timings,
  };
  if (!settings.liveSafetyEnabled) return { ...base, serverMs: Date.now() - t0 };

  const state = clipState(`${party.org_id}:${party.job_id}:${input.clipId}`, t0);
  const frame: SafetyFrame | null = input.frame ? { atSeconds: input.frame.atSeconds, base64: input.frame.base64 } : null;
  if (frame) {
    state.frames.push(frame);
    state.latestSeconds = Math.max(state.latestSeconds, frame.atSeconds);
  }
  if (input.audio) {
    state.latestSeconds = Math.max(state.latestSeconds, input.audio.startSeconds + input.audio.durationSeconds);
  }
  prune(state);

  return runWithAiUsageScope(
    {
      client: admin,
      orgId: party.org_id,
      jobId: party.job_id,
      requestId: `safety_live:${input.clipId}:${input.seq}`,
      meterFeature: VIDEO_ANALYSIS_FEATURE,
    },
    async () => {
      const tail = transcriptWindowText(state.lines.filter((l) => l.end >= state.latestSeconds - 20));
      const [heard, screen] = await Promise.all([
        input.audio
          ? (async () => {
              const s = Date.now();
              const r = await transcribeSegment(admin, party, input.clipId, input.seq, input.audio!);
              timings.whisperMs = Date.now() - s;
              return r;
            })()
          : Promise.resolve(null),
        frame
          ? (async () => {
              const s = Date.now();
              const r = await screenLiveFrame({ frame, transcriptTail: tail });
              timings.screenMs = Date.now() - s;
              return r;
            })()
          : Promise.resolve(null as ScreenResult | null),
      ]);

      const newLines: Line[] = [];
      if (heard?.text?.trim()) {
        const segs = heard.segments?.length
          ? heard.segments
          : [{ start: input.audio!.startSeconds, end: input.audio!.startSeconds + input.audio!.durationSeconds, text: heard.text }];
        for (const seg of segs) {
          if (seg.text?.trim()) newLines.push({ start: seg.start, end: seg.end, text: seg.text.trim() });
        }
        state.lines.push(...newLines);
        state.lines.sort((a, b) => a.start - b.start);
      }
      if (frame && screen) {
        state.screens.push({ atSeconds: frame.atSeconds, screenPlaying: screen.screenPlaying, candidate: screen.candidate });
      }
      prune(state);

      // Word list over the new speech plus the line before it (phrases split
      // across segments); it only nominates a candidate.
      let wordHit: ReturnType<typeof classifySafetyFromTranscript> | null = null;
      if (newLines.length) {
        const firstNew = newLines[0]!.start;
        const before = state.lines.filter((l) => l.start < firstNew).slice(-1);
        const probe = [...before, ...newLines].map((l) => l.text).join(' ');
        const hit = classifySafetyFromTranscript(probe, firstNew);
        if (hit.hit) wordHit = hit;
      }
      const screenHit = Boolean(screen?.candidate && screen.confidence >= LIVE_SCREEN_MIN_CONFIDENCE);
      const result: LiveSafetyResult = {
        ...base,
        heard: newLines.length ? newLines.map((l) => l.text).join(' ').slice(0, 400) : null,
        alert: state.alert,
      };
      if (!wordHit && !screenHit) return { ...result, serverMs: Date.now() - t0 };

      const trigger: SafetyCandidate['trigger'] =
        wordHit && screenHit ? 'word_list+frame_screen' : wordHit ? 'word_list' : 'frame_screen';
      result.screened = true;
      if (state.confirming) return { ...result, pending: true, serverMs: Date.now() - t0 };
      const notReal =
        state.lastReality === 'media_playback' || state.lastReality === 'joking' || state.lastReality === 'staged';
      const cooldown = notReal ? LIVE_CONFIRM_NOT_REAL_COOLDOWN_MS : LIVE_CONFIRM_COOLDOWN_MS;
      // A word-list + frame-screen agreement is new evidence: skip the cooldown.
      const stronger = trigger === 'word_list+frame_screen' && state.lastTrigger !== trigger;
      if (t0 - state.lastConfirmAtMs < cooldown && !stronger) {
        return { ...result, pending: true, serverMs: Date.now() - t0 };
      }
      state.confirmTimes = state.confirmTimes.filter((t) => t0 - t < 60 * 60 * 1000);
      if (state.confirmTimes.length >= LIVE_CONFIRM_MAX_PER_HOUR) {
        return { ...result, pending: true, serverMs: Date.now() - t0 };
      }
      state.confirmTimes.push(t0);

      state.confirming = true;
      try {
        const candidate: SafetyCandidate = {
          category: wordHit?.category ?? screen?.category ?? null,
          severity: wordHit?.severity ?? screen?.severity ?? 'critical',
          trigger,
          reason: [
            wordHit ? `word list "${String(wordHit.signals.rule ?? '')}" on: ${newLines.map((l) => l.text).join(' ').slice(0, 200)}` : '',
            screenHit ? `frame screen: ${screen?.note ?? ''}` : '',
          ]
            .filter(Boolean)
            .join(' · '),
        };
        const windowText = transcriptWindowText(state.lines);
        const mediaContext = mediaContextOf(state, windowText);
        const frames = pickFrames(
          state.frames.filter((f) => f.atSeconds >= state.latestSeconds - LIVE_FRAME_CONTEXT_SECONDS),
          8,
        );
        const sConfirm = Date.now();
        const conf = await confirmSafetyCandidate({
          candidate,
          frames,
          transcriptWindow: windowText,
          mediaContext,
          clipTimestampSeconds: state.latestSeconds,
        });
        timings.confirmMs = Date.now() - sConfirm;
        const decision = decideFromConfirmation(conf, candidate, {
          clipTimestampSeconds: wordHit?.clipTimestampSeconds ?? frame?.atSeconds ?? state.latestSeconds,
          mediaContext,
          frameCount: frames.length,
        });
        result.confirmed = true;
        result.reality = decision.reality ?? conf?.reality ?? null;
        state.lastReality = result.reality;
        if (!decision.hit) return { ...result, serverMs: Date.now() - t0 };

        const sAlert = Date.now();
        const created = await createSafetyIncident(admin, {
          orgId: party.org_id,
          jobId: party.job_id,
          partyId: party.id,
          clipId: input.clipId,
          classification: {
            ...decision,
            signals: { ...decision.signals, live: true, framesInContext: state.frames.length },
          },
          source: 'live_stream',
          lat: input.lat ?? null,
          lon: input.lon ?? null,
          locationLabel: input.locationLabel ?? null,
        });
        const incident: SafetyIncident = created.incident;
        if (created.created || created.upgraded) {
          try {
            await fanoutSafetyAlert(admin, incident, { upgraded: Boolean(created.upgraded) });
          } catch (err) {
            console.warn('[safety] live fanout failed:', err instanceof Error ? err.message : err);
          }
        }
        timings.alertMs = Date.now() - sAlert;
        state.alert = {
          incidentId: incident.id,
          confirmation: incident.confirmation,
          severity: incident.severity,
          title: incident.title,
        };
        return { ...result, alert: state.alert, serverMs: Date.now() - t0 };
      } finally {
        state.confirming = false;
        state.lastConfirmAtMs = Date.now();
        state.lastTrigger = trigger;
      }
    },
  );
}

/** proofRoute / fieldApp adapter: (party, admin, body). */
export async function processLiveSafetyChunkForParty(
  party: { org_id: string; job_id: string; id: string },
  admin: any,
  body: unknown,
): Promise<LiveSafetyResult> {
  return processLiveSafetyChunk(admin, party, body);
}

const workerOkSchema = z.object({ incidentId: z.string().uuid() });

/**
 * Worker tapped "I'm OK". Recorded and shown in Platform; it never recalls or
 * delays an alert that already went out.
 */
export async function recordWorkerOkForParty(
  party: { org_id: string; job_id: string; id: string },
  admin: any,
  body: unknown,
): Promise<{ ok: true; incidentId: string; workerOkAt: string | null }> {
  const { incidentId } = workerOkSchema.parse(body ?? {});
  const { getSafetyIncident, markWorkerOk } = await import('./incidents.js');
  const existing = await getSafetyIncident(admin, incidentId);
  if (!existing || existing.orgId !== party.org_id || existing.jobId !== party.job_id) {
    throw Object.assign(new Error('Incident not found'), { status: 404, code: 'safety_not_found' });
  }
  const updated = await markWorkerOk(admin, incidentId);
  return { ok: true, incidentId, workerOkAt: updated.workerOkAt };
}
