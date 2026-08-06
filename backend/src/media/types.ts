/**
 * Fleet media catalog — identity for video (and related) objects.
 *
 * Scale model:
 *   • One object (one field day / proof clip) is at most ~24h of video.
 *   • The platform retains many such objects across orgs — toward billions
 *     of hours in aggregate — in object storage, not in Postgres or the API.
 *
 * Postgres holds the catalog row (bytes, duration, tier, key). Bytes live in
 * a pluggable MediaStorageDriver (hot Supabase today; S3 + cold tier later).
 */

export const MEDIA_KINDS = [
  'proof_video',
  'proof_frame',
  'field_day_video',
  'twin_mesh',
  'scope_doc',
  'other',
] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** Hot = frequent playback; warm = infrequent; cold = archive / legal retain. */
export const MEDIA_TIERS = ['hot', 'warm', 'cold'] as const;
export type MediaTier = (typeof MEDIA_TIERS)[number];

export const MEDIA_STATES = ['pending_upload', 'ready', 'failed', 'deleted'] as const;
export type MediaState = (typeof MEDIA_STATES)[number];

export type MediaBackend = 'supabase' | 's3' | 'memory';

export type MediaObject = {
  id: string;
  orgId: string;
  kind: MediaKind;
  /** Seconds of timeline in this single object (capped ~24h per object). */
  durationSeconds: number | null;
  byteSize: number | null;
  contentHash: string | null;
  contentType: string | null;
  /**
   * Whether the stored container includes a microphone/audio track.
   * Required true for field_day_video / proof_video (see capturePolicy).
   */
  hasAudio: boolean | null;
  backend: MediaBackend;
  bucket: string;
  objectKey: string;
  tier: MediaTier;
  state: MediaState;
  /** Optional link into proof / twin / job rows (opaque to the catalog). */
  refType?: string | null;
  refId?: string | null;
  retentionUntil?: string | null;
  legalHold?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MediaUploadSession = {
  id: string;
  orgId: string;
  mediaId: string;
  /** Expected final size when known (multipart planning). */
  expectedByteSize: number | null;
  expectedDurationSeconds: number | null;
  contentType: string;
  /** Single-shot signed URL (Supabase hot path) and/or multipart parts later. */
  uploadUrl: string | null;
  /** When the driver supports S3-style multipart, part URLs land here. */
  multipart: null | {
    uploadId: string;
    partSizeBytes: number;
    partCount: number;
    parts: Array<{ partNumber: number; url: string }>;
  };
  expiresAt: string;
  createdAt: string;
};

export type OrgMediaQuota = {
  orgId: string;
  /** Soft ceiling on hot-tier bytes retained for this org (null = unlimited). */
  maxHotBytes: number | null;
  /** Soft ceiling on total retained bytes across tiers. */
  maxTotalBytes: number | null;
  /** Soft ceiling on ingest duration per UTC day (seconds). */
  maxIngestSecondsPerDay: number | null;
  /** Hard ceiling on a single object's bytes (null = config default). */
  maxObjectBytes: number | null;
};

export type OrgMediaUsage = {
  orgId: string;
  objectCount: number;
  totalBytes: number;
  hotBytes: number;
  warmBytes: number;
  coldBytes: number;
  /** Sum of duration_seconds for ready video-like objects. */
  totalDurationSeconds: number;
  ingestDurationSecondsToday: number;
};
