/**
 * Media catalog — Supabase Postgres is primary (same project as job_proofs).
 * Set MEDIA_STORE=memory for unit tests without a service role.
 */
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';
import { useMemoryMediaStore } from '../lib/adminClient.js';
import { assertAudiovisualPolicy, kindRequiresAudio } from './capturePolicy.js';
import { mediaDriverFor, mediaObjectKey, type MediaStorageDriver } from './driver.js';
import {
  fetchMediaForOrg,
  fetchMediaObject,
  fetchOrgQuota,
  fetchUploadSession,
  persistMediaObject,
  persistOrgQuota,
  persistUploadSession,
} from './persist.js';
import { assertWithinQuotas, usageOf, type CatalogView } from './quotas.js';
import { markSourceDeleted, vaultFromMediaObject } from '../legal/vault.js';
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

export async function setOrgQuota(quota: OrgMediaQuota): Promise<void> {
  quotas.set(quota.orgId, quota);
  await persistOrgQuota(quota);
}

export async function getOrgQuota(orgId: string): Promise<OrgMediaQuota> {
  const cached = quotas.get(orgId);
  if (cached) return cached;
  const fromDb = await fetchOrgQuota(orgId);
  if (fromDb) {
    quotas.set(orgId, fromDb);
    return fromDb;
  }
  return {
    orgId,
    maxHotBytes: config.media.defaultMaxHotBytes,
    maxTotalBytes: config.media.defaultMaxTotalBytes,
    maxIngestSecondsPerDay: config.media.defaultMaxIngestSecondsPerDay,
    maxObjectBytes: config.media.defaultMaxObjectBytes,
  };
}

export function orgUsage(orgId: string): OrgMediaUsage {
  return usageOf(orgId, view());
}

export async function orgUsageHydrated(orgId: string): Promise<OrgMediaUsage> {
  await listMediaForOrgHydrated(orgId);
  return orgUsage(orgId);
}

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
  hasAudio?: boolean | null;
  driver?: MediaStorageDriver;
}): Promise<{ media: MediaObject; session: MediaUploadSession }> {
  const duration = input.durationSeconds ?? null;
  const hasAudio = input.hasAudio ?? (kindRequiresAudio(input.kind) ? true : null);
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

  await listMediaForOrgHydrated(input.orgId);
  const quota = await getOrgQuota(input.orgId);
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

  // Production: Supabase storage (job-proofs / MEDIA_HOT_BUCKET). Tests pass memory driver.
  const driver =
    input.driver
    ?? (useMemoryMediaStore() ? mediaDriverFor('memory') : mediaDriverFor(config.media.backend));
  const created = await driver.createUpload({
    orgId: input.orgId,
    objectKey,
    contentType: input.contentType,
    byteSize: input.byteSize,
    preferMultipart:
      input.preferMultipart ?? (input.byteSize ?? 0) >= config.media.multipartThresholdBytes,
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
    deletedAt: null,
    deletedBy: null,
    createdAt: now,
    updatedAt: now,
  };
  objects.set(media.id, media);
  await persistMediaObject(media);

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
  await persistUploadSession(session);
  return { media, session };
}

export async function completeMediaUpload(input: {
  orgId: string;
  sessionId: string;
  byteSize?: number | null;
  contentHash?: string | null;
  durationSeconds?: number | null;
  hasAudio?: boolean | null;
}): Promise<MediaObject> {
  let session = sessions.get(input.sessionId) ?? null;
  if (!session) session = await fetchUploadSession(input.sessionId);
  if (!session || session.orgId !== input.orgId) {
    throw new HttpError(404, 'Upload session not found', 'upload_session_not_found');
  }
  sessions.set(session.id, session);

  let media = objects.get(session.mediaId) ?? null;
  if (!media) media = await fetchMediaObject(session.mediaId);
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
  await persistMediaObject(media);
  void vaultFromMediaObject(media).catch((err) => {
    console.warn('[legal] vault media failed:', err instanceof Error ? err.message : err);
  });

  const add = media.durationSeconds ?? 0;
  if (add > 0) {
    const key = dayKey(media.orgId);
    ingestDay.set(key, (ingestDay.get(key) ?? 0) + add);
  }

  return media;
}

export async function getMedia(id: string): Promise<MediaObject | null> {
  const cached = objects.get(id);
  if (cached) return cached;
  const fromDb = await fetchMediaObject(id);
  if (fromDb) objects.set(fromDb.id, fromDb);
  return fromDb;
}

export function listMediaForOrg(orgId: string): MediaObject[] {
  return [...objects.values()]
    .filter((m) => m.orgId === orgId && m.state !== 'deleted')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listMediaForOrgHydrated(orgId: string): Promise<MediaObject[]> {
  if (!useMemoryMediaStore()) {
    const rows = await fetchMediaForOrg(orgId);
    for (const m of rows) objects.set(m.id, m);
  }
  return listMediaForOrg(orgId);
}

/**
 * Hide a catalog object from the customer library. The vault keeps the key
 * and the bytes stay in object storage.
 */
export async function softDeleteMedia(
  mediaId: string,
  orgId: string,
  deletedBy?: string | null,
): Promise<MediaObject> {
  const media = await getMedia(mediaId);
  if (!media || media.orgId !== orgId) {
    throw new HttpError(404, 'Media object not found', 'media_not_found');
  }
  if (media.state === 'deleted' || media.deletedAt) {
    return media;
  }
  const now = new Date().toISOString();
  media.state = 'deleted';
  media.deletedAt = now;
  media.deletedBy = deletedBy ?? null;
  media.updatedAt = now;
  objects.set(media.id, media);
  await persistMediaObject(media);
  await markSourceDeleted('media_object', media.id);
  return media;
}

export async function markTier(
  mediaId: string,
  orgId: string,
  tier: MediaObject['tier'],
): Promise<MediaObject> {
  const media = await getMedia(mediaId);
  if (!media || media.orgId !== orgId) {
    throw new HttpError(404, 'Media object not found', 'media_not_found');
  }
  media.tier = tier;
  media.updatedAt = new Date().toISOString();
  objects.set(media.id, media);
  await persistMediaObject(media);
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
