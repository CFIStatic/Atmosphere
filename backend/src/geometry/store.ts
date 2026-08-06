/**
 * In-process twin store for the foundation surface.
 *
 * Durable persistence (Postgres / storage) lands with the App Store client
 * once sessions are production traffic; until then the API contract and
 * room-graph shape are what native and web clients integrate against.
 */
import { randomUUID } from 'node:crypto';
import { persistTwin } from './persist.js';
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

export function createTwin(input: {
  orgId: string;
  jobId?: string | null;
  label: string;
  primarySource: PropertyDigitalTwin['primarySource'];
}): PropertyDigitalTwin {
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
  void persistTwin(twin);
  return twin;
}

export function getTwin(id: string): PropertyDigitalTwin | null {
  return twins.get(id) ?? null;
}

export function listTwinsForOrg(orgId: string): PropertyDigitalTwin[] {
  return [...twins.values()]
    .filter((t) => t.orgId === orgId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function saveTwin(twin: PropertyDigitalTwin): PropertyDigitalTwin {
  twin.updatedAt = new Date().toISOString();
  twins.set(twin.id, twin);
  void persistTwin(twin);
  return twin;
}

export function applyRooms(
  twin: PropertyDigitalTwin,
  rooms: TwinRoom[],
  opts?: { mesh?: TwinMeshAsset | null; primarySource?: PropertyDigitalTwin['primarySource'] },
): PropertyDigitalTwin {
  twin.rooms = rooms;
  if (opts?.mesh !== undefined) twin.mesh = opts.mesh;
  if (opts?.primarySource) twin.primarySource = opts.primarySource;
  twin.status = rooms.length ? 'ready' : 'draft';
  return saveTwin(twin);
}

export function attachVideo(
  twin: PropertyDigitalTwin,
  video: TwinVideoEvidence,
): PropertyDigitalTwin {
  const without = twin.videos.filter((v) => v.id !== video.id);
  twin.videos = [...without, video];
  return saveTwin(twin);
}

export function upsertWork(
  twin: PropertyDigitalTwin,
  overlay: TwinWorkOverlay,
): PropertyDigitalTwin {
  const idx = twin.work.findIndex((w) => w.id === overlay.id);
  if (idx >= 0) twin.work[idx] = overlay;
  else twin.work.push(overlay);
  return saveTwin(twin);
}

export function createSession(input: {
  orgId: string;
  jobId?: string | null;
  twinId: string;
  platform: GeometryCaptureSession['platform'];
  measureApi?: GeometryCaptureSession['measureApi'];
  lidarAvailable?: boolean;
  videoRef?: string | null;
}): GeometryCaptureSession {
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
  return session;
}

export function getSession(id: string): GeometryCaptureSession | null {
  return sessions.get(id) ?? null;
}

export function saveSession(session: GeometryCaptureSession): GeometryCaptureSession {
  session.updatedAt = new Date().toISOString();
  sessions.set(session.id, session);
  return session;
}
