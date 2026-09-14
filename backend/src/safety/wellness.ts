/**
 * Silent panic / wellness check.
 *
 * Field Capture posts sparse motion + alone-on-site heartbeats while recording.
 * When no significant motion persists past org thresholds (and alone if required),
 * we open a safety_incidents row (category silent_panic_wellness) and nudge the
 * office. Ack/dismiss reuse the safety API. Atmosphere never calls 911.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { fanoutSafetyAlert } from './alerts.js';
import { createSafetyIncident } from './incidents.js';
import { loadOrgSafetySettings } from './settings.js';
import {
  WELLNESS_MOTION_SCORE_THRESHOLD,
  type OrgSafetySettings,
  type SafetyClassification,
  type SafetyIncident,
  type SafetySeverity,
} from './types.js';

export const wellnessHeartbeatSchema = z.object({
  workDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  phase: z.enum(['before', 'after']).optional(),
  clipId: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{6,64}$/)
    .optional(),
  clipTimestampSeconds: z.number().min(0).max(86_400).optional(),
  /** 0..1 frame-diff / device motion score. */
  motionScore: z.number().min(0).max(1),
  /** True when crew reports (or estimate suggests) they are alone on site. */
  aloneOnSite: z.boolean().default(true),
  personCountEstimate: z.number().int().min(0).max(50).optional(),
  recordingActive: z.boolean().default(true),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  locationLabel: z.string().max(400).optional(),
  /** Optional client clock for tests; server prefers Date.now(). */
  clientNowMs: z.number().int().positive().optional(),
});

export type WellnessHeartbeatInput = z.infer<typeof wellnessHeartbeatSchema>;

export type WellnessSessionState = {
  id: string;
  orgId: string;
  jobId: string;
  partyId: string | null;
  clipId: string | null;
  lastMotionAt: string;
  lastHeartbeatAt: string;
  aloneOnSite: boolean;
  lastMotionScore: number | null;
  personCountEstimate: number | null;
  recordingActive: boolean;
  lat: number | null;
  lon: number | null;
  locationLabel: string | null;
};

type MemorySession = WellnessSessionState;

const memorySessions = new Map<string, MemorySession>();

export function resetWellnessSessionsForTests(): void {
  memorySessions.clear();
}

function useMemory(): boolean {
  return process.env.SAFETY_STORE === 'memory' || process.env.WELLNESS_STORE === 'memory';
}

function sessionKey(orgId: string, jobId: string, clipId: string | null | undefined): string {
  return `${orgId}:${jobId}:${clipId ?? ''}`;
}

function rowFromDb(r: any): WellnessSessionState {
  return {
    id: r.id,
    orgId: r.org_id,
    jobId: r.job_id,
    partyId: r.party_id ?? null,
    clipId: r.clip_id ?? null,
    lastMotionAt: r.last_motion_at,
    lastHeartbeatAt: r.last_heartbeat_at,
    aloneOnSite: r.alone_on_site !== false,
    lastMotionScore: r.last_motion_score == null ? null : Number(r.last_motion_score),
    personCountEstimate:
      r.person_count_estimate == null ? null : Number(r.person_count_estimate),
    recordingActive: r.recording_active !== false,
    lat: r.lat == null ? null : Number(r.lat),
    lon: r.lon == null ? null : Number(r.lon),
    locationLabel: r.location_label ?? null,
  };
}

async function loadSession(
  admin: any,
  orgId: string,
  jobId: string,
  clipId: string | null,
): Promise<WellnessSessionState | null> {
  if (useMemory()) {
    return memorySessions.get(sessionKey(orgId, jobId, clipId)) ?? null;
  }

  let q = admin
    .from('wellness_session_state')
    .select('*')
    .eq('org_id', orgId)
    .eq('job_id', jobId)
    .limit(1);
  q = clipId ? q.eq('clip_id', clipId) : q.is('clip_id', null);
  const { data, error } = await q.maybeSingle();
  if (error) {
    if (/wellness_session_state|does not exist|42P01/i.test(error.message ?? '')) return null;
    throw new Error(error.message);
  }
  return data ? rowFromDb(data) : null;
}

async function saveSession(
  admin: any,
  state: WellnessSessionState,
): Promise<WellnessSessionState> {
  if (useMemory()) {
    memorySessions.set(sessionKey(state.orgId, state.jobId, state.clipId), state);
    return state;
  }

  const updatedAt = new Date().toISOString();
  const payload = {
    org_id: state.orgId,
    job_id: state.jobId,
    party_id: state.partyId,
    clip_id: state.clipId,
    last_motion_at: state.lastMotionAt,
    last_heartbeat_at: state.lastHeartbeatAt,
    alone_on_site: state.aloneOnSite,
    last_motion_score: state.lastMotionScore,
    person_count_estimate: state.personCountEstimate,
    recording_active: state.recordingActive,
    lat: state.lat,
    lon: state.lon,
    location_label: state.locationLabel,
    updated_at: updatedAt,
  };

  const existing = await loadSession(admin, state.orgId, state.jobId, state.clipId);
  if (existing) {
    const { data, error } = await admin
      .from('wellness_session_state')
      .update(payload)
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return rowFromDb(data);
  }

  const { data, error } = await admin
    .from('wellness_session_state')
    .insert({ id: state.id, ...payload, created_at: updatedAt })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return rowFromDb(data);
}

export type WellnessEval = {
  shouldAlert: boolean;
  severity: SafetySeverity | null;
  noMotionSeconds: number;
  aloneOk: boolean;
  reason: string;
};

/**
 * Pure threshold evaluation — exported for unit tests.
 */
export function evaluateWellness(
  settings: OrgSafetySettings,
  input: {
    noMotionSeconds: number;
    aloneOnSite: boolean;
    recordingActive: boolean;
  },
): WellnessEval {
  if (!settings.wellnessCheckEnabled) {
    return {
      shouldAlert: false,
      severity: null,
      noMotionSeconds: input.noMotionSeconds,
      aloneOk: true,
      reason: 'disabled',
    };
  }
  if (!input.recordingActive) {
    return {
      shouldAlert: false,
      severity: null,
      noMotionSeconds: input.noMotionSeconds,
      aloneOk: true,
      reason: 'not_recording',
    };
  }

  const aloneOk = settings.wellnessRequireAlone ? input.aloneOnSite === true : true;
  if (!aloneOk) {
    return {
      shouldAlert: false,
      severity: null,
      noMotionSeconds: input.noMotionSeconds,
      aloneOk: false,
      reason: 'not_alone',
    };
  }

  if (input.noMotionSeconds >= settings.wellnessCriticalAfterSeconds) {
    return {
      shouldAlert: true,
      severity: 'critical',
      noMotionSeconds: input.noMotionSeconds,
      aloneOk: true,
      reason: 'no_motion_critical',
    };
  }
  if (input.noMotionSeconds >= settings.wellnessNoMotionSeconds) {
    return {
      shouldAlert: true,
      severity: 'watch',
      noMotionSeconds: input.noMotionSeconds,
      aloneOk: true,
      reason: 'no_motion_watch',
    };
  }

  return {
    shouldAlert: false,
    severity: null,
    noMotionSeconds: input.noMotionSeconds,
    aloneOk: true,
    reason: 'within_threshold',
  };
}

function classificationFor(
  severity: SafetySeverity,
  noMotionSeconds: number,
  aloneOnSite: boolean,
  clipTimestampSeconds: number | null,
  signals: Record<string, unknown>,
): SafetyClassification {
  const minutes = Math.max(1, Math.round(noMotionSeconds / 60));
  const aloneBit = aloneOnSite ? 'alone on site' : 'on site';
  return {
    hit: true,
    category: 'silent_panic_wellness',
    severity,
    confidence: severity === 'critical' ? 0.9 : 0.8,
    title:
      severity === 'critical'
        ? `Silent panic · no motion ~${minutes}m`
        : `Wellness check · no motion ~${minutes}m`,
    description:
      `Field Capture reports ~${minutes} minute(s) without significant motion while ${aloneBit}. ` +
      `Please check on the crew. Atmosphere does not call 911 — acknowledge or dismiss in Platform.`,
    // Wellness never recommends contact_authorities (no auto-911 path).
    recommendedAction: severity === 'critical' ? 'dispatch_help' : 'monitor',
    clipTimestampSeconds,
    model: 'wellness_threshold',
    signals,
  };
}

export type WellnessHeartbeatResult = {
  ok: true;
  enabled: boolean;
  motionReset: boolean;
  noMotionSeconds: number;
  eval: WellnessEval;
  session: WellnessSessionState | null;
  hit: boolean;
  incident: SafetyIncident | null;
  created: boolean;
  suppressedDuplicate: boolean;
  channels: string[];
};

export async function processWellnessHeartbeat(
  admin: any,
  party: { org_id: string; job_id: string; id: string },
  body: unknown,
): Promise<WellnessHeartbeatResult> {
  const input = wellnessHeartbeatSchema.parse(body ?? {});
  const settings = await loadOrgSafetySettings(admin, party.org_id);
  const nowMs = input.clientNowMs && input.clientNowMs > 0 ? input.clientNowMs : Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const clipId = input.clipId ?? null;

  const prev = await loadSession(admin, party.org_id, party.job_id, clipId);
  const motionReset = input.motionScore >= WELLNESS_MOTION_SCORE_THRESHOLD;
  const lastMotionAt = motionReset
    ? nowIso
    : (prev?.lastMotionAt ?? nowIso);
  const noMotionSeconds = Math.max(
    0,
    Math.floor((nowMs - new Date(lastMotionAt).getTime()) / 1000),
  );

  const session = await saveSession(admin, {
    id: prev?.id ?? randomUUID(),
    orgId: party.org_id,
    jobId: party.job_id,
    partyId: party.id,
    clipId,
    lastMotionAt,
    lastHeartbeatAt: nowIso,
    aloneOnSite: input.aloneOnSite,
    lastMotionScore: input.motionScore,
    personCountEstimate: input.personCountEstimate ?? null,
    recordingActive: input.recordingActive,
    lat: input.lat ?? prev?.lat ?? null,
    lon: input.lon ?? prev?.lon ?? null,
    locationLabel: input.locationLabel ?? prev?.locationLabel ?? null,
  });

  const evaluation = evaluateWellness(settings, {
    noMotionSeconds,
    aloneOnSite: input.aloneOnSite,
    recordingActive: input.recordingActive,
  });

  if (!evaluation.shouldAlert || !evaluation.severity) {
    return {
      ok: true,
      enabled: settings.wellnessCheckEnabled,
      motionReset,
      noMotionSeconds,
      eval: evaluation,
      session,
      hit: false,
      incident: null,
      created: false,
      suppressedDuplicate: false,
      channels: [],
    };
  }

  const classification = classificationFor(
    evaluation.severity,
    noMotionSeconds,
    input.aloneOnSite,
    input.clipTimestampSeconds ?? null,
    {
      motionScore: input.motionScore,
      aloneOnSite: input.aloneOnSite,
      personCountEstimate: input.personCountEstimate ?? null,
      noMotionSeconds,
      wellnessNoMotionSeconds: settings.wellnessNoMotionSeconds,
      wellnessCriticalAfterSeconds: settings.wellnessCriticalAfterSeconds,
      wellnessRequireAlone: settings.wellnessRequireAlone,
      reason: evaluation.reason,
    },
  );

  const { incident, created, suppressedDuplicate } = await createSafetyIncident(admin, {
    orgId: party.org_id,
    jobId: party.job_id,
    partyId: party.id,
    clipId,
    classification,
    source: 'wellness_heartbeat',
    lat: input.lat ?? null,
    lon: input.lon ?? null,
    locationLabel: input.locationLabel ?? null,
  });

  let channels: string[] = [];
  if (created) {
    try {
      const fanout = await fanoutSafetyAlert(admin, incident);
      channels = fanout.channels;
    } catch (err) {
      console.warn('[wellness] fanout failed:', err instanceof Error ? err.message : err);
    }
  }

  return {
    ok: true,
    enabled: settings.wellnessCheckEnabled,
    motionReset,
    noMotionSeconds,
    eval: evaluation,
    session,
    hit: true,
    incident,
    created,
    suppressedDuplicate,
    channels,
  };
}

/** proofRoute / fieldApp adapter: (party, admin, body). */
export async function processWellnessHeartbeatForParty(
  party: { org_id: string; job_id: string; id: string },
  admin: any,
  body: unknown,
): Promise<WellnessHeartbeatResult> {
  return processWellnessHeartbeat(admin, party, body);
}
