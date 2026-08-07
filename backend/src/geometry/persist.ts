/**
 * Supabase is the primary store for property_twins (same project as proofs).
 */
import { HttpError } from '../lib/errors.js';
import { adminOrNull, requireAdmin, useMemoryGeometryStore } from '../lib/adminClient.js';
import type { GeometryCaptureSession, PropertyDigitalTwin } from './types.js';

export async function persistTwin(twin: PropertyDigitalTwin): Promise<void> {
  if (useMemoryGeometryStore()) return;
  const admin = requireAdmin();
  const { error } = await admin.from('property_twins').upsert(
    {
      id: twin.id,
      org_id: twin.orgId,
      job_id: twin.jobId,
      label: twin.label,
      status: twin.status,
      primary_source: twin.primarySource,
      payload: twin,
      updated_at: twin.updatedAt,
      created_at: twin.createdAt,
    },
    { onConflict: 'id' },
  );
  if (error) {
    throw new HttpError(502, `property_twins upsert failed: ${error.message}`, 'twin_persist_failed');
  }
}

export async function fetchTwin(id: string): Promise<PropertyDigitalTwin | null> {
  if (useMemoryGeometryStore()) return null;
  const admin = adminOrNull();
  if (!admin) return null;
  const { data, error } = await admin
    .from('property_twins')
    .select('payload')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    if (/does not exist|42P01/i.test(error.message)) return null;
    throw new HttpError(502, error.message, 'twin_fetch_failed');
  }
  const twin = (data as { payload?: PropertyDigitalTwin } | null)?.payload;
  return twin?.id ? twin : null;
}

export async function fetchTwinsForOrg(orgId: string): Promise<PropertyDigitalTwin[]> {
  if (useMemoryGeometryStore()) return [];
  const admin = requireAdmin();
  const { data, error } = await admin
    .from('property_twins')
    .select('payload')
    .eq('org_id', orgId)
    .order('updated_at', { ascending: false })
    .limit(200);
  if (error) {
    if (/does not exist|42P01/i.test(error.message)) return [];
    throw new HttpError(502, error.message, 'twin_list_failed');
  }
  return (data ?? [])
    .map((row) => (row as { payload?: PropertyDigitalTwin }).payload)
    .filter((t): t is PropertyDigitalTwin => Boolean(t?.id));
}

export async function persistGeometrySession(session: GeometryCaptureSession): Promise<void> {
  if (useMemoryGeometryStore()) return;
  const admin = requireAdmin();
  const { error } = await admin.from('geometry_capture_sessions').upsert(
    {
      id: session.id,
      org_id: session.orgId,
      job_id: session.jobId,
      twin_id: session.twinId,
      platform: session.platform,
      measure_api: session.measureApi ?? null,
      lidar_available: session.lidarAvailable ?? null,
      video_ref: session.videoRef ?? null,
      status: session.status,
      error: session.error ?? null,
      created_at: session.createdAt,
      updated_at: session.updatedAt,
    },
    { onConflict: 'id' },
  );
  if (error) {
    if (/does not exist|42P01/i.test(error.message)) return;
    throw new HttpError(502, error.message, 'geometry_session_persist_failed');
  }
}

export async function fetchGeometrySession(id: string): Promise<GeometryCaptureSession | null> {
  if (useMemoryGeometryStore()) return null;
  const admin = adminOrNull();
  if (!admin) return null;
  const { data, error } = await admin
    .from('geometry_capture_sessions')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    if (/does not exist|42P01/i.test(error.message)) return null;
    throw new HttpError(502, error.message, 'geometry_session_fetch_failed');
  }
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    id: String(r.id),
    orgId: String(r.org_id),
    jobId: (r.job_id as string) ?? null,
    twinId: String(r.twin_id),
    platform: r.platform as GeometryCaptureSession['platform'],
    measureApi: (r.measure_api as GeometryCaptureSession['measureApi']) ?? undefined,
    lidarAvailable: r.lidar_available == null ? undefined : Boolean(r.lidar_available),
    videoRef: (r.video_ref as string) ?? null,
    status: r.status as GeometryCaptureSession['status'],
    error: (r.error as string) ?? null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}
