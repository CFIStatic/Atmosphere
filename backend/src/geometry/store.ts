/**
 * Property twin store — Supabase Postgres primary (property_twins).
 * GEOMETRY_STORE=memory for unit tests without a service role.
 */
import { randomUUID } from 'node:crypto';
import { useMemoryGeometryStore } from '../lib/adminClient.js';
import {
  fetchGeometrySession,
  fetchTwin,
  fetchTwinsForOrg,
  persistGeometrySession,
  persistTwin,
} from './persist.js';
import type {
  GeometryCaptureSession,
  PropertyDigitalTwin,
  TwinMeshAsset,
  TwinRoom,
  TwinVideoEvidence,
  TwinWorkOverlay,
} from './types.js';

const twins = new Map<string, PropertyDigitalTwin>();
const sessions = new Map<string, GeometryCaptureSession>();

export function resetGeometryStoreForTests(): void {
  twins.clear();
  sessions.clear();
}

export async function createTwin(input: {
  orgId: string;
  jobId?: string | null;
  label: string;
  primarySource: PropertyDigitalTwin['primarySource'];
}): Promise<PropertyDigitalTwin> {
  const now = new Date().toISOString();
  const twin: PropertyDigitalTwin = {
    id: randomUUID(),
    orgId: input.orgId,
    jobId: input.jobId ?? null,
    label: input.label,
    status: 'draft',
    primarySource: input.primarySource,
    rooms: [],
    mesh: null,
    videos: [],
    work: [],
    photos: [],
    createdAt: now,
    updatedAt: now,
  };
  twins.set(twin.id, twin);
  await persistTwin(twin);
  return twin;
}

export async function getTwin(id: string): Promise<PropertyDigitalTwin | null> {
  const cached = twins.get(id);
  if (cached) return cached;
  const fromDb = await fetchTwin(id);
  if (fromDb) twins.set(fromDb.id, fromDb);
  return fromDb;
}

export function listTwinsForOrg(orgId: string): PropertyDigitalTwin[] {
  return [...twins.values()]
    .filter((t) => t.orgId === orgId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listTwinsForOrgHydrated(orgId: string): Promise<PropertyDigitalTwin[]> {
  if (!useMemoryGeometryStore()) {
    const rows = await fetchTwinsForOrg(orgId);
    for (const t of rows) twins.set(t.id, t);
  }
  return listTwinsForOrg(orgId);
}

export async function saveTwin(twin: PropertyDigitalTwin): Promise<PropertyDigitalTwin> {
  twin.updatedAt = new Date().toISOString();
  twins.set(twin.id, twin);
  await persistTwin(twin);
  return twin;
}

export async function applyRooms(
  twin: PropertyDigitalTwin,
  rooms: TwinRoom[],
  opts?: { mesh?: TwinMeshAsset | null; primarySource?: PropertyDigitalTwin['primarySource'] },
): Promise<PropertyDigitalTwin> {
  twin.rooms = rooms;
  if (opts?.mesh !== undefined) twin.mesh = opts.mesh;
  if (opts?.primarySource) twin.primarySource = opts.primarySource;
  twin.status = rooms.length ? 'ready' : 'draft';
  return saveTwin(twin);
}

export async function attachVideo(
  twin: PropertyDigitalTwin,
  video: TwinVideoEvidence,
): Promise<PropertyDigitalTwin> {
  const without = twin.videos.filter((v) => v.id !== video.id);
  twin.videos = [...without, video];
  return saveTwin(twin);
}

export async function upsertWork(
  twin: PropertyDigitalTwin,
  overlay: TwinWorkOverlay,
): Promise<PropertyDigitalTwin> {
  const idx = twin.work.findIndex((w) => w.id === overlay.id);
  if (idx >= 0) twin.work[idx] = overlay;
  else twin.work.push(overlay);
  return saveTwin(twin);
}

export async function createSession(input: {
  orgId: string;
  jobId?: string | null;
  twinId: string;
  platform: GeometryCaptureSession['platform'];
  measureApi?: GeometryCaptureSession['measureApi'];
  lidarAvailable?: boolean;
  videoRef?: string | null;
}): Promise<GeometryCaptureSession> {
  const now = new Date().toISOString();
  const session: GeometryCaptureSession = {
    id: randomUUID(),
    orgId: input.orgId,
    jobId: input.jobId ?? null,
    twinId: input.twinId,
    platform: input.platform,
    measureApi: input.measureApi,
    lidarAvailable: input.lidarAvailable,
    videoRef: input.videoRef ?? null,
    status: 'open',
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  sessions.set(session.id, session);
  await persistGeometrySession(session);
  return session;
}

export async function getSession(id: string): Promise<GeometryCaptureSession | null> {
  const cached = sessions.get(id);
  if (cached) return cached;
  const fromDb = await fetchGeometrySession(id);
  if (fromDb) sessions.set(fromDb.id, fromDb);
  return fromDb;
}

export async function saveSession(session: GeometryCaptureSession): Promise<GeometryCaptureSession> {
  session.updatedAt = new Date().toISOString();
  sessions.set(session.id, session);
  await persistGeometrySession(session);
  return session;
}
