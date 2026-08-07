/**
 * Supabase (Postgres) is the primary catalog for media_objects.
 * Same project / admin client as job_proofs.
 */
import { HttpError } from '../lib/errors.js';
import { adminOrNull, requireAdmin, useMemoryMediaStore } from '../lib/adminClient.js';
import type { MediaObject, MediaUploadSession, OrgMediaQuota } from './types.js';

export function mediaRowToObject(r: Record<string, unknown>): MediaObject {
  return {
    id: String(r.id),
    orgId: String(r.org_id),
    kind: r.kind as MediaObject['kind'],
    durationSeconds: r.duration_seconds != null ? Number(r.duration_seconds) : null,
    byteSize: r.byte_size != null ? Number(r.byte_size) : null,
    contentHash: (r.content_hash as string) ?? null,
    contentType: (r.content_type as string) ?? null,
    hasAudio: r.has_audio == null ? null : Boolean(r.has_audio),
    backend: r.backend as MediaObject['backend'],
    bucket: String(r.bucket),
    objectKey: String(r.object_key),
    tier: r.tier as MediaObject['tier'],
    state: r.state as MediaObject['state'],
    refType: (r.ref_type as string) ?? null,
    refId: (r.ref_id as string) ?? null,
    retentionUntil: (r.retention_until as string) ?? null,
    legalHold: Boolean(r.legal_hold),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export async function persistMediaObject(media: MediaObject): Promise<void> {
  if (useMemoryMediaStore()) return;
  const admin = requireAdmin();
  const { error } = await admin.from('media_objects').upsert(
    {
      id: media.id,
      org_id: media.orgId,
      kind: media.kind,
      duration_seconds: media.durationSeconds,
      byte_size: media.byteSize,
      content_hash: media.contentHash,
      content_type: media.contentType,
      has_audio: media.hasAudio,
      backend: media.backend,
      bucket: media.bucket,
      object_key: media.objectKey,
      tier: media.tier,
      state: media.state,
      ref_type: media.refType ?? null,
      ref_id: media.refId ?? null,
      retention_until: media.retentionUntil ?? null,
      legal_hold: media.legalHold ?? false,
      updated_at: media.updatedAt,
      created_at: media.createdAt,
    },
    { onConflict: 'id' },
  );
  if (error) {
    throw new HttpError(502, `media_objects upsert failed: ${error.message}`, 'media_persist_failed');
  }
}

export async function fetchMediaObject(id: string): Promise<MediaObject | null> {
  if (useMemoryMediaStore()) return null;
  const admin = adminOrNull();
  if (!admin) return null;
  const { data, error } = await admin.from('media_objects').select('*').eq('id', id).maybeSingle();
  if (error) throw new HttpError(502, error.message, 'media_fetch_failed');
  return data ? mediaRowToObject(data as Record<string, unknown>) : null;
}

export async function fetchMediaForOrg(orgId: string): Promise<MediaObject[]> {
  if (useMemoryMediaStore()) return [];
  const admin = requireAdmin();
  const { data, error } = await admin
    .from('media_objects')
    .select('*')
    .eq('org_id', orgId)
    .neq('state', 'deleted')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw new HttpError(502, error.message, 'media_list_failed');
  return (data ?? []).map((row) => mediaRowToObject(row as Record<string, unknown>));
}

export async function persistOrgQuota(quota: OrgMediaQuota): Promise<void> {
  if (useMemoryMediaStore()) return;
  const admin = requireAdmin();
  const { error } = await admin.from('org_media_quotas').upsert(
    {
      org_id: quota.orgId,
      max_hot_bytes: quota.maxHotBytes,
      max_total_bytes: quota.maxTotalBytes,
      max_ingest_seconds_per_day: quota.maxIngestSecondsPerDay,
      max_object_bytes: quota.maxObjectBytes,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'org_id' },
  );
  if (error) {
    throw new HttpError(502, `org_media_quotas upsert failed: ${error.message}`, 'quota_persist_failed');
  }
}

export async function fetchOrgQuota(orgId: string): Promise<OrgMediaQuota | null> {
  if (useMemoryMediaStore()) return null;
  const admin = adminOrNull();
  if (!admin) return null;
  const { data, error } = await admin
    .from('org_media_quotas')
    .select('*')
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw new HttpError(502, error.message, 'quota_fetch_failed');
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    orgId,
    maxHotBytes: r.max_hot_bytes != null ? Number(r.max_hot_bytes) : null,
    maxTotalBytes: r.max_total_bytes != null ? Number(r.max_total_bytes) : null,
    maxIngestSecondsPerDay:
      r.max_ingest_seconds_per_day != null ? Number(r.max_ingest_seconds_per_day) : null,
    maxObjectBytes: r.max_object_bytes != null ? Number(r.max_object_bytes) : null,
  };
}

export async function persistUploadSession(session: MediaUploadSession): Promise<void> {
  if (useMemoryMediaStore()) return;
  const admin = requireAdmin();
  const { error } = await admin.from('media_upload_sessions').upsert(
    {
      id: session.id,
      org_id: session.orgId,
      media_id: session.mediaId,
      expected_byte_size: session.expectedByteSize,
      expected_duration_seconds: session.expectedDurationSeconds,
      content_type: session.contentType,
      upload_url: session.uploadUrl,
      multipart: session.multipart,
      expires_at: session.expiresAt,
      created_at: session.createdAt,
    },
    { onConflict: 'id' },
  );
  if (error) {
    // Table may not exist until migration applied — fall back to memory session only.
    if (/does not exist|42P01/i.test(error.message)) return;
    throw new HttpError(502, error.message, 'upload_session_persist_failed');
  }
}

export async function fetchUploadSession(id: string): Promise<MediaUploadSession | null> {
  if (useMemoryMediaStore()) return null;
  const admin = adminOrNull();
  if (!admin) return null;
  const { data, error } = await admin
    .from('media_upload_sessions')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    if (/does not exist|42P01/i.test(error.message)) return null;
    throw new HttpError(502, error.message, 'upload_session_fetch_failed');
  }
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    id: String(r.id),
    orgId: String(r.org_id),
    mediaId: String(r.media_id),
    expectedByteSize: r.expected_byte_size != null ? Number(r.expected_byte_size) : null,
    expectedDurationSeconds:
      r.expected_duration_seconds != null ? Number(r.expected_duration_seconds) : null,
    contentType: String(r.content_type),
    uploadUrl: (r.upload_url as string) ?? null,
    multipart: (r.multipart as MediaUploadSession['multipart']) ?? null,
    expiresAt: String(r.expires_at),
    createdAt: String(r.created_at),
  };
}
