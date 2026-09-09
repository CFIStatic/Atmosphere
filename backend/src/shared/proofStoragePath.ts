import { HttpError } from '../lib/errors.js';

const EXTENSION = /^[a-z0-9]{2,5}$/;
/** Phone-minted id for one recording: lowercase base36, 6–32 characters. */
export const CLIP_ID = /^[a-z0-9]{6,32}$/;
const OWNED_PATH =
  /^([^/]+)\/([^/]+)\/([^/]+)\/(\d{4}-\d{2}-\d{2})-(before|after)(?:-([a-z0-9]{6,32}))?\.([a-z0-9]{2,5})$/;

export type ProofPartyRef = {
  org_id: string;
  job_id: string;
  id: string;
};

export function normalizeClipId(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const clipId = String(raw).trim().toLowerCase();
  if (!CLIP_ID.test(clipId)) {
    throw new HttpError(400, 'Invalid clip id.', 'invalid_clip_id');
  }
  return clipId;
}

/**
 * The only path a job-share / field-app token may write. The party id is in
 * the folder so a leaked signed URL cannot be aimed at another job.
 *
 * With a `clipId` every recording gets its own object, so a crew can stop one
 * film and start the next on the same job the same day without the second
 * overwriting the first. Without one (older phones) the path is one object per
 * party, day and phase, and a re-upload replaces it.
 */
export function proofObjectPath(
  party: ProofPartyRef,
  input: { workDate: string; phase: string; extension: string; clipId?: string | null },
): string {
  const extension = input.extension.toLowerCase();
  if (!EXTENSION.test(extension)) {
    throw new HttpError(400, 'Invalid file extension.', 'invalid_extension');
  }
  const clipId = normalizeClipId(input.clipId);
  const stem = clipId
    ? `${input.workDate}-${input.phase}-${clipId}`
    : `${input.workDate}-${input.phase}`;
  return `${party.org_id}/${party.job_id}/${party.id}/${stem}.${extension}`;
}

/** The clip id carried in a storage path, or null for a legacy one-per-day path. */
export function clipIdOfStoragePath(storagePath: string): string | null {
  const match = OWNED_PATH.exec(String(storagePath ?? '').trim());
  return match?.[6] ?? null;
}

/**
 * `recordProof` used to store whatever `storagePath` the client sent. A token
 * holder could then file another party's object (or skip the upload). The
 * recorded path must be the one this party was given to upload.
 */
export function assertOwnedProofStoragePath(
  party: ProofPartyRef,
  input: { workDate: string; phase: string; storagePath: string; clipId?: string | null },
): string {
  const storagePath = input.storagePath.trim();
  const match = OWNED_PATH.exec(storagePath);
  if (!match) {
    throw new HttpError(400, 'storagePath does not match this job.', 'storage_path_mismatch');
  }
  const [, orgId, jobId, partyId, workDate, phase, clipId] = match;
  if (
    orgId !== party.org_id ||
    jobId !== party.job_id ||
    partyId !== party.id ||
    workDate !== input.workDate ||
    phase !== input.phase
  ) {
    throw new HttpError(400, 'storagePath does not match this job.', 'storage_path_mismatch');
  }
  if (input.clipId !== undefined && (clipId ?? null) !== normalizeClipId(input.clipId)) {
    throw new HttpError(400, 'storagePath does not match this job.', 'storage_path_mismatch');
  }
  return storagePath;
}
