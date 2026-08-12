import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '../lib/errors.js';
import {
  completeSessionSchema,
  heartbeatSchema,
  organizedDeviceContext,
  samplesSchema,
  startSessionSchema,
  summarizeLocations,
  summarizeMotion,
  type DeviceBundle,
} from './schema.js';

type Admin = SupabaseClient;

const SESSION_SELECT =
  'id, org_id, job_id, party_id, user_id, proof_id, work_date, status, platform, ' +
  'app_version, started_at, ended_at, device, permissions, capabilities, environment, ' +
  'capture, location_summary, motion_summary, created_at, updated_at';

function mergeBundle(existing: unknown, patch: unknown): Record<string, unknown> {
  const base =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base;
  return { ...base, ...(patch as Record<string, unknown>) };
}

async function loadSession(admin: Admin, orgId: string, sessionId: string) {
  const { data, error } = await admin
    .from('field_capture_sessions')
    .select(SESSION_SELECT)
    .eq('org_id', orgId)
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message, 'context_session_failed');
  if (!data) throw new HttpError(404, 'Field context session not found.', 'context_not_found');
  return data as Record<string, any>;
}

async function insertLocationSamples(
  admin: Admin,
  orgId: string,
  sessionId: string,
  locations: ReturnType<typeof samplesSchema.parse>['locations'] | undefined,
) {
  if (!locations?.length) return 0;
  const rows = locations.map((s) => ({
    org_id: orgId,
    session_id: sessionId,
    recorded_at: s.recordedAt,
    lat: s.lat,
    lon: s.lon,
    accuracy_m: s.accuracyM ?? null,
    altitude_m: s.altitudeM ?? null,
    altitude_accuracy_m: s.altitudeAccuracyM ?? null,
    speed_mps: s.speedMps ?? null,
    course_deg: s.courseDeg ?? null,
    floor: s.floor ?? null,
  }));
  const { error } = await admin.from('field_location_samples').insert(rows);
  if (error) throw new HttpError(400, error.message, 'location_samples_failed');
  return rows.length;
}

async function insertMotionSamples(
  admin: Admin,
  orgId: string,
  sessionId: string,
  motion: ReturnType<typeof samplesSchema.parse>['motion'] | undefined,
) {
  if (!motion?.length) return 0;
  const rows = motion.map((s) => ({
    org_id: orgId,
    session_id: sessionId,
    recorded_at: s.recordedAt,
    activity: s.activity ?? null,
    confidence: s.confidence ?? null,
    pitch_deg: s.pitchDeg ?? null,
    roll_deg: s.rollDeg ?? null,
    yaw_deg: s.yawDeg ?? null,
    pressure_hpa: s.pressureHpa ?? null,
    relative_altitude_m: s.relativeAltitudeM ?? null,
    step_count: s.stepCount ?? null,
  }));
  const { error } = await admin.from('field_motion_samples').insert(rows);
  if (error) throw new HttpError(400, error.message, 'motion_samples_failed');
  return rows.length;
}

export async function startFieldContextSession(
  admin: Admin,
  args: {
    orgId: string;
    userId: string;
    partyId: string | null;
    body: unknown;
  },
) {
  const input = startSessionSchema.parse(args.body ?? {});

  const { data: job } = await admin
    .from('crm_jobs')
    .select('id')
    .eq('org_id', args.orgId)
    .eq('id', input.jobId)
    .maybeSingle();
  if (!job) throw new HttpError(404, 'No such job in your organization.', 'job_not_found');

  const { data, error } = await admin
    .from('field_capture_sessions')
    .insert({
      org_id: args.orgId,
      job_id: input.jobId,
      party_id: args.partyId,
      user_id: args.userId,
      work_date: input.workDate ?? null,
      status: 'open',
      platform: input.platform,
      app_version: input.appVersion ?? input.device?.appVersion ?? null,
      device: input.device ?? {},
      permissions: input.permissions ?? {},
      capabilities: input.capabilities ?? {},
      environment: input.environment ?? {},
    })
    .select(SESSION_SELECT)
    .single();
  if (error || !data) {
    throw new HttpError(400, error?.message ?? 'Could not open context session.', 'context_start_failed');
  }
  return { session: shapeSession(data) };
}

export async function heartbeatFieldContextSession(
  admin: Admin,
  args: { orgId: string; sessionId: string; body: unknown },
) {
  const input = heartbeatSchema.parse(args.body ?? {});
  const session = await loadSession(admin, args.orgId, args.sessionId);
  if (session.status !== 'open') {
    throw new HttpError(409, 'This context session is already closed.', 'context_closed');
  }

  const locationCount = await insertLocationSamples(
    admin,
    args.orgId,
    args.sessionId,
    input.locations,
  );
  const motionCount = await insertMotionSamples(admin, args.orgId, args.sessionId, input.motion);

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    device: mergeBundle(session.device, input.device),
    permissions: mergeBundle(session.permissions, input.permissions),
    capabilities: mergeBundle(session.capabilities, input.capabilities),
    environment: mergeBundle(session.environment, input.environment),
  };

  if (input.locations?.length) {
    patch.location_summary = mergeBundle(
      session.location_summary,
      summarizeLocations(input.locations),
    );
  }
  if (input.motion?.length) {
    patch.motion_summary = mergeBundle(session.motion_summary, summarizeMotion(input.motion));
  }

  const { data, error } = await admin
    .from('field_capture_sessions')
    .update(patch)
    .eq('id', args.sessionId)
    .eq('org_id', args.orgId)
    .select(SESSION_SELECT)
    .single();
  if (error || !data) {
    throw new HttpError(400, error?.message ?? 'Could not update context session.', 'context_heartbeat_failed');
  }

  return {
    session: shapeSession(data),
    accepted: { locations: locationCount, motion: motionCount },
  };
}

export async function completeFieldContextSession(
  admin: Admin,
  args: { orgId: string; sessionId: string; body: unknown },
) {
  const input = completeSessionSchema.parse(args.body ?? {});
  const session = await loadSession(admin, args.orgId, args.sessionId);

  const endedAt = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status: input.status,
    ended_at: endedAt,
    updated_at: endedAt,
    device: mergeBundle(session.device, input.device),
    permissions: mergeBundle(session.permissions, input.permissions),
    capabilities: mergeBundle(session.capabilities, input.capabilities),
    environment: mergeBundle(session.environment, input.environment),
    capture: mergeBundle(session.capture, input.capture),
    location_summary: mergeBundle(session.location_summary, input.locationSummary),
    motion_summary: mergeBundle(session.motion_summary, input.motionSummary),
  };
  if (input.proofId) patch.proof_id = input.proofId;

  const { data, error } = await admin
    .from('field_capture_sessions')
    .update(patch)
    .eq('id', args.sessionId)
    .eq('org_id', args.orgId)
    .select(SESSION_SELECT)
    .single();
  if (error || !data) {
    throw new HttpError(400, error?.message ?? 'Could not complete context session.', 'context_complete_failed');
  }
  const row = data as Record<string, any>;

  if (input.proofId) {
    const deviceContext = organizedDeviceContext({
      platform: row.platform,
      contextSessionId: row.id,
      device: row.device as DeviceBundle,
      permissions: row.permissions,
      capabilities: row.capabilities,
      environment: row.environment,
      capture: row.capture,
      locationSummary: row.location_summary,
      motionSummary: row.motion_summary,
    });
    await admin
      .from('job_proofs')
      .update({ device_context: deviceContext })
      .eq('id', input.proofId)
      .eq('org_id', args.orgId);
  }

  return { session: shapeSession(row) };
}

export async function listFieldContextSessions(
  admin: Admin,
  args: { orgId: string; jobId?: string; limit?: number },
) {
  const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
  let query = admin
    .from('field_capture_sessions')
    .select(SESSION_SELECT)
    .eq('org_id', args.orgId)
    .order('started_at', { ascending: false })
    .limit(limit);
  if (args.jobId) query = query.eq('job_id', args.jobId);

  const { data, error } = await query;
  if (error) throw new HttpError(500, error.message, 'context_list_failed');

  const rows = (data ?? []) as Record<string, any>[];
  const jobIds = [...new Set(rows.map((r) => r.job_id).filter(Boolean))];
  const titleById = new Map<string, string>();
  if (jobIds.length) {
    const { data: jobs } = await admin
      .from('crm_jobs')
      .select('id, title, job_number')
      .in('id', jobIds);
    for (const j of (jobs ?? []) as any[]) {
      const num = j.job_number != null ? `#${j.job_number} ` : '';
      titleById.set(j.id, `${num}${j.title || 'Job'}`.trim());
    }
  }

  return {
    sessions: rows.map((r) => ({
      ...shapeSession(r),
      jobTitle: titleById.get(r.job_id) ?? null,
    })),
  };
}

export async function getFieldContextSession(
  admin: Admin,
  args: { orgId: string; sessionId: string },
) {
  const session = await loadSession(admin, args.orgId, args.sessionId);

  const [{ data: locations }, { data: motion }] = await Promise.all([
    admin
      .from('field_location_samples')
      .select(
        'id, recorded_at, lat, lon, accuracy_m, altitude_m, altitude_accuracy_m, speed_mps, course_deg, floor',
      )
      .eq('session_id', args.sessionId)
      .eq('org_id', args.orgId)
      .order('recorded_at', { ascending: true })
      .limit(2000),
    admin
      .from('field_motion_samples')
      .select(
        'id, recorded_at, activity, confidence, pitch_deg, roll_deg, yaw_deg, pressure_hpa, relative_altitude_m, step_count',
      )
      .eq('session_id', args.sessionId)
      .eq('org_id', args.orgId)
      .order('recorded_at', { ascending: true })
      .limit(2000),
  ]);

  let jobTitle: string | null = null;
  const { data: job } = await admin
    .from('crm_jobs')
    .select('title, job_number')
    .eq('id', session.job_id)
    .maybeSingle();
  if (job) {
    const num = (job as any).job_number != null ? `#${(job as any).job_number} ` : '';
    jobTitle = `${num}${(job as any).title || 'Job'}`.trim();
  }

  return {
    session: { ...shapeSession(session), jobTitle },
    categories: {
      device: session.device ?? {},
      permissions: session.permissions ?? {},
      capabilities: session.capabilities ?? {},
      environment: session.environment ?? {},
      capture: session.capture ?? {},
      locationSummary: session.location_summary ?? {},
      motionSummary: session.motion_summary ?? {},
    },
    locations: ((locations ?? []) as any[]).map((r) => ({
      id: r.id,
      recordedAt: r.recorded_at,
      lat: r.lat === null ? null : Number(r.lat),
      lon: r.lon === null ? null : Number(r.lon),
      accuracyM: r.accuracy_m === null || r.accuracy_m === undefined ? null : Number(r.accuracy_m),
      altitudeM: r.altitude_m === null || r.altitude_m === undefined ? null : Number(r.altitude_m),
      altitudeAccuracyM:
        r.altitude_accuracy_m === null || r.altitude_accuracy_m === undefined
          ? null
          : Number(r.altitude_accuracy_m),
      speedMps: r.speed_mps === null || r.speed_mps === undefined ? null : Number(r.speed_mps),
      courseDeg: r.course_deg === null || r.course_deg === undefined ? null : Number(r.course_deg),
      floor: r.floor ?? null,
    })),
    motion: ((motion ?? []) as any[]).map((r) => ({
      id: r.id,
      recordedAt: r.recorded_at,
      activity: r.activity,
      confidence: r.confidence === null || r.confidence === undefined ? null : Number(r.confidence),
      pitchDeg: r.pitch_deg === null || r.pitch_deg === undefined ? null : Number(r.pitch_deg),
      rollDeg: r.roll_deg === null || r.roll_deg === undefined ? null : Number(r.roll_deg),
      yawDeg: r.yaw_deg === null || r.yaw_deg === undefined ? null : Number(r.yaw_deg),
      pressureHpa:
        r.pressure_hpa === null || r.pressure_hpa === undefined ? null : Number(r.pressure_hpa),
      relativeAltitudeM:
        r.relative_altitude_m === null || r.relative_altitude_m === undefined
          ? null
          : Number(r.relative_altitude_m),
      stepCount: r.step_count ?? null,
    })),
  };
}

function shapeSession(row: Record<string, any>) {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    jobId: row.job_id as string,
    partyId: (row.party_id as string | null) ?? null,
    userId: (row.user_id as string | null) ?? null,
    proofId: (row.proof_id as string | null) ?? null,
    workDate: (row.work_date as string | null) ?? null,
    status: row.status as string,
    platform: row.platform as string,
    appVersion: (row.app_version as string | null) ?? null,
    startedAt: row.started_at as string,
    endedAt: (row.ended_at as string | null) ?? null,
    device: row.device ?? {},
    permissions: row.permissions ?? {},
    capabilities: row.capabilities ?? {},
    environment: row.environment ?? {},
    capture: row.capture ?? {},
    locationSummary: row.location_summary ?? {},
    motionSummary: row.motion_summary ?? {},
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
