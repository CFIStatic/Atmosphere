/**
 * In-process media catalog for the foundation surface.
 *
 * Durable rows live in `media_objects` (migration). This store lets upload
 * sessions, quota checks, and twin/proof wiring land against a stable API
 * before every path is cut over from `job_proofs.storage_path`.
 */
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';
import { assertAudiovisualPolicy, kindRequiresAudio } from './capturePolicy.js';
import { mediaDriverFor, mediaObjectKey, type MediaStorageDriver } from './driver.js';
import { assertWithinQuotas, usageOf, type CatalogView } from './quotas.js';
import type {
  MediaKind,
  MediaObject,
  MediaUploadSession,
  OrgMediaQuota,
  OrgMediaUsage,
} from './types.js';

const objects = new Map<string, MediaObject>();
const sessions = new Map<string, MediaUploadSession>();
const quotas = new Map<string, OrgMediaQuota>();
/** Ingest seconds keyed by orgId → YYYY-MM-DD (UTC). */
const ingestDay = new Map<string, number>();

export function resetMediaCatalogForTests(): void {
  objects.clear();
  sessions.clear();
  quotas.clear();
  ingestDay.clear();
}

function dayKey(orgId: string, at = new Date()): string {
  return `${orgId}:${at.toISOString().slice(0, 10)}`;
}

function view(): CatalogView {
  return {
    objects: [...objects.values()],
    ingestSecondsToday: (orgId) => ingestDay.get(dayKey(orgId)) ?? 0,
  };
}

export function setOrgQuota(quota: OrgMediaQuota): void {
  quotas.set(quota.orgId, quota);
}

export function getOrgQuota(orgId: string): OrgMediaQuota {
  return (
    quotas.get(orgId) ?? {
      orgId,
      maxHotBytes: config.media.defaultMaxHotBytes,
      maxTotalBytes: config.media.defaultMaxTotalBytes,
      maxIngestSecondsPerDay: config.media.defaultMaxIngestSecondsPerDay,
      maxObjectBytes: config.media.defaultMaxObjectBytes,
    }
  );
}

export function orgUsage(orgId: string): OrgMediaUsage {
  return usageOf(orgId, view());
}

/**
 * Open an upload session for one object (≤ ~24h video).
 * Enforces per-object duration/bytes and soft org quotas before minting URLs.
 */
export async function beginMediaUpload(input: {
  orgId: string;
  kind: MediaKind;
  contentType: string;
  durationSeconds?: number | null;
  byteSize?: number | null;
  ext?: string;
  refType?: string | null;
  refId?: string | null;
  preferMultipart?: boolean;
  /**
   * Client attestation that the recording includes a mic track.
   * Defaults to true for audiovisual kinds (Field Capture always films A/V).
   */
  hasAudio?: boolean | null;
  /** Test / override hook — production uses config.media.backend. */
  driver?: MediaStorageDriver;
}): Promise<{ media: MediaObject; session: MediaUploadSession }> {
  const duration = input.durationSeconds ?? null;
  const hasAudio =
    input.hasAudio ?? (kindRequiresAudio(input.kind) ? true : null);
  assertAudiovisualPolicy({ kind: input.kind, hasAudio, strict: true });
  if (duration != null) {
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new HttpError(400, 'durationSeconds must be positive', 'invalid_duration');
    }
    if (duration > config.verification.maxDurationSeconds) {
      throw new HttpError(
        400,
        `One video may be at most ${config.verification.maxDurationSeconds}s (~24h). Fleet retention is many such objects, not one longer file.`,
        'duration_too_long',
      );
    }
  }

  const quota = getOrgQuota(input.orgId);
  assertWithinQuotas({
    quota,
    usage: orgUsage(input.orgId),
    incomingBytes: input.byteSize ?? 0,
    incomingDurationSeconds: duration ?? 0,
    maxObjectDurationSeconds: config.verification.maxDurationSeconds,
  });

  const now = new Date().toISOString();
  const mediaId = randomUUID();
  const ext = input.ext ?? guessExt(input.contentType);
  const objectKey = mediaObjectKey({
    orgId: input.orgId,
    kind: input.kind,
    mediaId,
    ext,
  });

  const driver = input.driver ?? mediaDriverFor();
  const created = await driver.createUpload({
    orgId: input.orgId,
    objectKey,
    contentType: input.contentType,
    byteSize: input.byteSize,
    preferMultipart: input.preferMultipart ?? (input.byteSize ?? 0) >= config.media.multipartThresholdBytes,
  });

  const media: MediaObject = {
    id: mediaId,
    orgId: input.orgId,
    kind: input.kind,
    durationSeconds: duration,
    byteSize: input.byteSize ?? null,
    contentHash: null,
    contentType: input.contentType,
    hasAudio,
    backend: created.backend,
    bucket: created.bucket,
    objectKey: created.objectKey,
    tier: 'hot',
    state: 'pending_upload',
    refType: input.refType ?? null,
    refId: input.refId ?? null,
    retentionUntil: null,
    legalHold: false,
    createdAt: now,
    updatedAt: now,
  };
  objects.set(media.id, media);

  const session: MediaUploadSession = {
    id: randomUUID(),
    orgId: input.orgId,
    mediaId: media.id,
    expectedByteSize: input.byteSize ?? null,
    expectedDurationSeconds: duration,
    contentType: input.contentType,
    uploadUrl: created.uploadUrl,
    multipart: created.multipart,
    expiresAt: created.expiresAt.toISOString(),
    createdAt: now,
  };
  sessions.set(session.id, session);
  return { media, session };
}

export function completeMediaUpload(input: {
  orgId: string;
  sessionId: string;
  byteSize?: number | null;
  contentHash?: string | null;
  durationSeconds?: number | null;
  hasAudio?: boolean | null;
}): MediaObject {
  const session = sessions.get(input.sessionId);
  if (!session || session.orgId !== input.orgId) {
    throw new HttpError(404, 'Upload session not found', 'upload_session_not_found');
  }
  const media = objects.get(session.mediaId);
  if (!media || media.orgId !== input.orgId) {
    throw new HttpError(404, 'Media object not found', 'media_not_found');
  }

  if (input.hasAudio != null) media.hasAudio = input.hasAudio;
  assertAudiovisualPolicy({
    kind: media.kind,
    hasAudio: media.hasAudio,
    strict: true,
  });

  if (input.durationSeconds != null) {
    if (input.durationSeconds > config.verification.maxDurationSeconds) {
      throw new HttpError(
        400,
        `One video may be at most ${config.verification.maxDurationSeconds}s (~24h).`,
        'duration_too_long',
      );
    }
    media.durationSeconds = input.durationSeconds;
  }
  if (input.byteSize != null) media.byteSize = input.byteSize;
  if (input.contentHash != null) media.contentHash = input.contentHash;

  media.state = 'ready';
  media.updatedAt = new Date().toISOString();
  objects.set(media.id, media);

  const add = media.durationSeconds ?? 0;
  if (add > 0) {
    const key = dayKey(media.orgId);
    ingestDay.set(key, (ingestDay.get(key) ?? 0) + add);
  }

  return media;
}

export function getMedia(id: string): MediaObject | null {
  return objects.get(id) ?? null;
}

export function listMediaForOrg(orgId: string): MediaObject[] {
  return [...objects.values()]
    .filter((m) => m.orgId === orgId && m.state !== 'deleted')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function markTier(mediaId: string, orgId: string, tier: MediaObject['tier']): MediaObject {
  const media = objects.get(mediaId);
  if (!media || media.orgId !== orgId) {
    throw new HttpError(404, 'Media object not found', 'media_not_found');
  }
  media.tier = tier;
  media.updatedAt = new Date().toISOString();
  objects.set(media.id, media);
  return media;
}

function guessExt(contentType: string): string {
  if (contentType.includes('mp4')) return 'mp4';
  if (contentType.includes('quicktime')) return 'mov';
  if (contentType.includes('webm')) return 'webm';
  if (contentType.includes('jpeg')) return 'jpg';
  if (contentType.includes('usdz') || contentType.includes('model')) return 'usdz';
  return 'bin';
}
