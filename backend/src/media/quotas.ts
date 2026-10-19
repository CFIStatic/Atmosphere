/**
 * Per-file ceilings for fleet video.
 *
 * There is no workspace storage, total or daily-filming quota: every upload
 * is kept as the job's record. Only per-object limits (~24h, 80 GiB) apply,
 * so one file stays physically uploadable.
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

  // No workspace storage, total or daily-filming quota: Atmosphere is the job's
  // system of record. Only the per-file ceilings above remain.
  void usage;
}

/** Human-facing fleet rollup — hours, not a claim about current holdings. */
export function formatDurationHours(seconds: number): number {
  return Math.round((seconds / 3600) * 1000) / 1000;
}
