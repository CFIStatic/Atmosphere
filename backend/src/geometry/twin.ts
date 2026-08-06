/**
 * Assemble and summarize a property digital twin.
 *
 * The twin is the office-facing model: measured rooms (from the App Store
 * Field app or DocuSketch), optional mesh, linked day video, and work
 * overlays describing what is happening in those spaces.
 */
import { randomUUID } from 'node:crypto';
import { HttpError } from '../lib/errors.js';
import { ingestDeviceGeometry, isMetricGeometrySource } from './fromDevice.js';
import {
  applyRooms,
  attachVideo,
  getTwin,
  saveTwin,
  upsertWork,
} from './store.js';
import type {
  DeviceGeometryIngest,
  PropertyDigitalTwin,
  TwinVideoEvidence,
} from './types.js';

export type TwinSummary = {
  twinId: string;
  status: PropertyDigitalTwin['status'];
  primarySource: PropertyDigitalTwin['primarySource'];
  roomCount: number;
  totalFloorSqFt: number;
  hasMesh: boolean;
  videoCount: number;
  workCount: number;
  metric: boolean;
};

export function summarizeTwin(twin: PropertyDigitalTwin): TwinSummary {
  return {
    twinId: twin.id,
    status: twin.status,
    primarySource: twin.primarySource,
    roomCount: twin.rooms.length,
    totalFloorSqFt: twin.rooms.reduce((s, r) => s + (r.floorAreaSqFt || 0), 0),
    hasMesh: Boolean(twin.mesh?.url),
    videoCount: twin.videos.length,
    workCount: twin.work.length,
    metric: isMetricGeometrySource(twin.primarySource) && twin.rooms.length > 0,
  };
}

/**
 * Apply an App Store / device measurement ingest onto an existing twin.
 * Video alone never marks the twin metric — rooms must arrive from a
 * measuring source.
 */
export function ingestMeasurementsOntoTwin(
  twinId: string,
  ingest: DeviceGeometryIngest,
): PropertyDigitalTwin {
  const twin = getTwin(twinId);
  if (!twin) throw new HttpError(404, 'Digital twin not found', 'twin_not_found');

  const rooms = ingestDeviceGeometry(ingest);
  applyRooms(twin, rooms, {
    mesh: ingest.mesh ?? twin.mesh,
    primarySource: ingest.source,
  });

  if (ingest.videoRef) {
    const evidence: TwinVideoEvidence = {
      id: randomUUID(),
      videoRef: ingest.videoRef,
      capturedAt: ingest.capturedAt ?? new Date().toISOString(),
      dictationSummary: ingest.dictationSummary ?? null,
    };
    attachVideo(twin, evidence);
  }

  const now = new Date().toISOString();
  for (const w of ingest.work ?? []) {
    upsertWork(twin, {
      id: w.id ?? randomUUID(),
      roomId: w.roomId,
      label: w.label,
      scopeTitle: w.scopeTitle,
      status: w.status,
      evidenceVideoIds: w.evidenceVideoIds,
      note: w.note,
      updatedAt: now,
    });
  }

  if (!rooms.length) {
    twin.status = 'needs_review';
    saveTwin(twin);
  }

  return twin;
}

/**
 * Attach field-day video evidence without claiming new measurements.
 * Used when the crew filmed but LiDAR/RoomPlan was unavailable.
 */
export function attachVideoEvidenceOnly(
  twinId: string,
  video: Omit<TwinVideoEvidence, 'id'> & { id?: string },
): PropertyDigitalTwin {
  const twin = getTwin(twinId);
  if (!twin) throw new HttpError(404, 'Digital twin not found', 'twin_not_found');
  attachVideo(twin, {
    id: video.id ?? randomUUID(),
    videoRef: video.videoRef,
    roomId: video.roomId,
    startSeconds: video.startSeconds,
    endSeconds: video.endSeconds,
    capturedAt: video.capturedAt,
    dictationSummary: video.dictationSummary,
  });
  if (!twin.rooms.length) twin.status = 'needs_review';
  return saveTwin(twin);
}
