/**
 * Write-through persistence for the media catalog.
 * When Supabase admin is configured, rows land in media_objects.
 * Memory remains the request cache; restarts reload nothing until a
 * list-from-db path is added — but production deploys with a DB keep
 * durable identity for uploads that completed.
 */
import { createAdminClient } from '../lib/supabase.js';
import type { MediaObject, OrgMediaQuota } from './types.js';

export async function persistMediaObject(media: MediaObject): Promise<void> {
  const admin = createAdminClient();
  if (!admin) return;
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
    // Don't fail the upload API because the catalog mirror lagged — log via throw in tests only.
    console.warn('[media.persist]', error.message);
  }
}

export async function persistOrgQuota(quota: OrgMediaQuota): Promise<void> {
  const admin = createAdminClient();
  if (!admin) return;
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
  if (error) console.warn('[media.persist.quota]', error.message);
}
