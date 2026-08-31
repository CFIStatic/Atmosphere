/**
 * Turn App Store / on-device measurement payloads into estimator-compatible
 * room rows. Derives missing SF from L×W×H the same way mitigation ingest
 * does — measured areas always win when the device sends them.
 */
import { randomUUID } from 'node:crypto';
import type { Opening, RoomMeasurements } from '../estimator/types.js';
import { deriveGeometry, round } from './roomGeometry.js';
import type { DeviceGeometryIngest, DeviceRoomPayload, TwinRoom } from './types.js';

export function deviceRoomToMeasurements(room: DeviceRoomPayload): RoomMeasurements {
  const geo = deriveGeometry({
    lengthFt: room.lengthFt,
    widthFt: room.widthFt,
    heightFt: room.heightFt,
    floorSF: room.floorAreaSqFt,
    ceilingSF: room.ceilingAreaSqFt,
    wallSF: room.wallAreaSqFt,
    perimeterLF: room.perimeterLf,
    openingSF: openingsArea(room.openings),
  });

  return {
    id: room.id?.trim() || randomUUID(),
    name: room.name.trim() || 'Room',
    roomType: room.roomType,
    level: room.level,
    floorAreaSqFt: geo.floorSF,
    ceilingAreaSqFt: geo.ceilingSF,
    wallAreaSqFt: geo.wallSF,
    perimeterLf: geo.perimeterLF,
    ceilingHeightFt: geo.heightFt,
    openings: (room.openings ?? []).map(normalizeOpening),
  };
}

export function ingestDeviceGeometry(input: DeviceGeometryIngest): TwinRoom[] {
  return input.rooms.map((room) => ({
    ...deviceRoomToMeasurements(room),
    source: input.source,
    confidence: clamp01(room.confidence),
  }));
}

/** True when a source can supply metric scale for a twin room graph. */
export function isMetricGeometrySource(source: string): boolean {
  return source === 'arkit' || source === 'roomplan' || source === 'lidar'
    || source === 'docusketch' || source === 'manual' || source === 'notes';
}

function openingsArea(openings: Opening[] | undefined): number {
  if (!openings?.length) return 0;
  return round(openings.reduce((sum, o) => sum + Math.max(0, o.width) * Math.max(0, o.height), 0));
}

function normalizeOpening(o: Opening): Opening {
  return {
    kind: o.kind,
    width: Math.max(0, Number(o.width) || 0),
    height: Math.max(0, Number(o.height) || 0),
    sharedWithRoomId: o.sharedWithRoomId,
  };
}

function clamp01(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(1, Math.max(0, value));
}
