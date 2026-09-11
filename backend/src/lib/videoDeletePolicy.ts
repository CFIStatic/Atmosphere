/**
 * Atmosphere video deletion policy.
 *
 * Only a Global Admin may queue a clip for deletion. The clip leaves the
 * library immediately (deleted_at) and is permanently removed after 30 days
 * (scheduled_purge_at), unless restored or blocked by a legal hold.
 */
import { isGlobalAdmin } from './productRoles.js';
import { HttpError } from './errors.js';

export const VIDEO_DELETE_PENDING_MS = 30 * 24 * 60 * 60 * 1000;

export function scheduledPurgeAt(from: Date = new Date()): string {
  return new Date(from.getTime() + VIDEO_DELETE_PENDING_MS).toISOString();
}

/** Refuse unless the caller is a Global Admin (legacy office_manager maps in). */
export function assertGlobalAdminCanDeleteVideo(role: string | null | undefined): void {
  if (!isGlobalAdmin(role)) {
    throw new HttpError(
      403,
      'Only a Global Admin can delete a video.',
      'insufficient_role',
    );
  }
}

export function isPendingPurge(row: {
  deleted_at?: string | null;
  scheduled_purge_at?: string | null;
}): boolean {
  return Boolean(row.deleted_at && row.scheduled_purge_at);
}

/** True when the pending window has elapsed (purge worker may remove bytes). */
export function purgeWindowElapsed(
  scheduledPurgeAtIso: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!scheduledPurgeAtIso) return false;
  const at = Date.parse(scheduledPurgeAtIso);
  if (Number.isNaN(at)) return false;
  return at <= now.getTime();
}
