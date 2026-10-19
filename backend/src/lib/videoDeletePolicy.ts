/**
 * Atmosphere video deletion policy.
 *
 * Atmosphere is the job's system of record, so evidence bytes are never
 * erased by the product. Deleting a video only hides it (deleted_at) and is
 * written to the audit trail; it can be restored at any time, and a legal
 * hold still blocks the delete. There is no purge window and no worker that
 * removes stored files.
 */
import { isGlobalAdmin } from './productRoles.js';
import { HttpError } from './errors.js';

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

/** True when a clip is hidden from the library (soft-deleted). Bytes are kept. */
export function isHiddenVideo(row: { deleted_at?: string | null }): boolean {
  return Boolean(row.deleted_at);
}
