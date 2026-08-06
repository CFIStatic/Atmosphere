/**
 * Soft quota math for fleet video retention.
 *
 * Quotas protect a single org from unbounded hot-tier spend. They do not
 * invent cluster capacity — "billions of hours" is an object-storage
 * economics problem (tiering + retention), enforced here only as ceilings
 * the product can configure per org.
 */
import { HttpError } from '../lib/errors.js';
import type { MediaObject, OrgMediaQuota, OrgMediaUsage } from './types.js';

export type CatalogView = {
  objects: MediaObject[];
  ingestSecondsToday: (orgId: string) => number;
};

export function usageOf(orgId: string, view: CatalogView): OrgMediaUsage {
  const mine = view.objects.filter((m) => m.orgId === orgId && m.state === 'ready');
  let totalBytes = 0;
  let hotBytes = 0;
  let warmBytes = 0;
  let coldBytes = 0;
  let totalDurationSeconds = 0;
  for (const m of mine) {
    const bytes = m.byteSize ?? 0;
    totalBytes += bytes;
    if (m.tier === 'hot') hotBytes += bytes;
    else if (m.tier === 'warm') warmBytes += bytes;
    else coldBytes += bytes;
    totalDurationSeconds += m.durationSeconds ?? 0;
  }
  return {
    orgId,
    objectCount: mine.length,
    totalBytes,
    hotBytes,
    warmBytes,
    coldBytes,
    totalDurationSeconds,
    ingestDurationSecondsToday: view.ingestSecondsToday(orgId),
  };
}

export function assertWithinQuotas(input: {
  quota: OrgMediaQuota;
  usage: OrgMediaUsage;
  incomingBytes: number;
  incomingDurationSeconds: number;
  maxObjectDurationSeconds: number;
}): void {
  const { quota, usage } = input;
  const bytes = Math.max(0, input.incomingBytes);
  const duration = Math.max(0, input.incomingDurationSeconds);

  if (duration > input.maxObjectDurationSeconds) {
    throw new HttpError(
      400,
      `One video may be at most ${input.maxObjectDurationSeconds}s (~24h).`,
      'duration_too_long',
    );
  }

  const maxObject = quota.maxObjectBytes;
  if (maxObject != null && bytes > maxObject) {
    throw new HttpError(
      413,
      `This file exceeds the per-object byte ceiling (${maxObject} bytes).`,
      'object_too_large',
    );
  }

  if (quota.maxHotBytes != null && usage.hotBytes + bytes > quota.maxHotBytes) {
    throw new HttpError(
      402,
      'Hot-tier storage quota exceeded for this organisation. Move older video to warm/cold or raise the quota.',
      'hot_quota_exceeded',
    );
  }

  if (quota.maxTotalBytes != null && usage.totalBytes + bytes > quota.maxTotalBytes) {
    throw new HttpError(
      402,
      'Total storage quota exceeded for this organisation.',
      'total_quota_exceeded',
    );
  }

  if (
    quota.maxIngestSecondsPerDay != null
    && usage.ingestDurationSecondsToday + duration > quota.maxIngestSecondsPerDay
  ) {
    throw new HttpError(
      429,
      'Daily ingest duration quota exceeded for this organisation.',
      'ingest_quota_exceeded',
    );
  }
}

/** Human-facing fleet rollup — hours, not a claim about current holdings. */
export function formatDurationHours(seconds: number): number {
  return Math.round((seconds / 3600) * 1000) / 1000;
}
