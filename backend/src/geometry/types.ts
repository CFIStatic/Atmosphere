/**
 * Property digital twin — vendor-neutral geometry + work overlay.
 *
 * Metric scale comes from a measuring device (App Store Field app with
 * ARKit / RoomPlan / LiDAR, or DocuSketch), not from RGB video alone.
 * Video still matters: it is the visual record of the space and of work
 * as it progresses, linked onto the twin as evidence and work overlays.
 *
 * Room shapes reuse the estimator's RoomMeasurements so a twin can feed
 * mitigation / construction estimating without a second geometry model.
 */
import type { JobPhoto, Opening, RoomMeasurements } from '../estimator/types.js';

/** How the metric room graph was obtained. */
export const GEOMETRY_SOURCES = [
  'arkit',
  'roomplan',
  'lidar',
  'docusketch',
  'manual',
  'notes',
  /** RGB / video frames only — not metric by itself; may attach evidence. */
  'video_evidence',
] as const;
export type GeometrySource = (typeof GEOMETRY_SOURCES)[number];

export type TwinStatus = 'draft' | 'measuring' | 'ready' | 'needs_review';

/** Optional mesh / USDZ / GLB the native app (or DocuSketch) exported. */
export type TwinMeshAsset = {
  format: 'usdz' | 'obj' | 'glb' | 'ply' | 'other';
  /** Signed or durable URL; bytes stay in object storage. */
  url: string;
  byteSize?: number;
  contentType?: string;
  /** Device / exporter that produced the mesh. */
  producedBy?: GeometrySource;
};

/** A stretch of field video that belongs to a room or work area on the twin. */
export type TwinVideoEvidence = {
  id: string;
  /** Storage path or media id from proof / field capture / media pipeline. */
  videoRef: string;
  roomId?: string;
  startSeconds?: number;
  endSeconds?: number;
  capturedAt?: string;
  /** Dictation / narration summary when the video pipeline has run. */
  dictationSummary?: string | null;
};

/**
 * Work observed on the twin — what was done in the measured space, not the
 * architecture of the building itself.
 */
export type TwinWorkOverlay = {
  id: string;
  roomId?: string;
  label: string;
  /** Scope line or trade tag when known. */
  scopeTitle?: string;
  status: 'planned' | 'in_progress' | 'done' | 'blocked';
  evidenceVideoIds?: string[];
  note?: string;
  updatedAt: string;
};

export type TwinRoom = RoomMeasurements & {
  /** Provenance for this room's dimensions. */
  source: GeometrySource;
  /** Confidence 0–1 from the device / scanner when provided. */
  confidence?: number;
};

/**
 * The property digital twin: measured spaces + optional mesh + linked
 * video of the area and the work being done.
 */
export type PropertyDigitalTwin = {
  id: string;
  orgId: string;
  jobId?: string | null;
  label: string;
  status: TwinStatus;
  /** Primary metric source for the room graph. */
  primarySource: GeometrySource;
  rooms: TwinRoom[];
  mesh?: TwinMeshAsset | null;
  videos: TwinVideoEvidence[];
  work: TwinWorkOverlay[];
  photos: JobPhoto[];
  createdAt: string;
  updatedAt: string;
};

/**
 * A Field / App Store capture session that may produce measurements while
 * (or after) filming. Sessions bind device geometry + video to one twin.
 */
export type GeometryCaptureSession = {
  id: string;
  orgId: string;
  jobId?: string | null;
  twinId: string;
  /** Platform of the capturing client. */
  platform: 'ios' | 'android' | 'web' | 'external';
  /** Preferred measurement API on device. */
  measureApi?: 'roomplan' | 'arkit' | 'lidar' | 'none';
  lidarAvailable?: boolean;
  videoRef?: string | null;
  status: 'open' | 'ingested' | 'failed';
  error?: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Payload the App Store Field app posts after a RoomPlan / ARKit pass. */
export type DeviceRoomPayload = {
  id?: string;
  name: string;
  roomType?: string;
  level?: string;
  /** Feet — preferred when the device reports L×W×H. */
  lengthFt?: number;
  widthFt?: number;
  heightFt?: number;
  floorAreaSqFt?: number;
  ceilingAreaSqFt?: number;
  wallAreaSqFt?: number;
  perimeterLf?: number;
  openings?: Opening[];
  confidence?: number;
};

export type DeviceGeometryIngest = {
  source: Extract<GeometrySource, 'arkit' | 'roomplan' | 'lidar' | 'manual'>;
  rooms: DeviceRoomPayload[];
  mesh?: TwinMeshAsset | null;
  /** Optional field-day video already uploaded (storage path or media id). */
  videoRef?: string | null;
  dictationSummary?: string | null;
  work?: Array<Omit<TwinWorkOverlay, 'id' | 'updatedAt'> & { id?: string }>;
  capturedAt?: string;
};
