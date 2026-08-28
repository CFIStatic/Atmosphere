import { HttpError } from '../lib/errors.js';

const EXTENSION = /^[a-z0-9]{2,5}$/;

export type ProofPartyRef = {
  org_id: string;
  job_id: string;
  id: string;
};

/**
 * The only path a job-share / field-app token may write. The party id is in
 * the folder so a leaked signed URL cannot be aimed at another job.
 */
export function proofObjectPath(
  party: ProofPartyRef,
  input: { workDate: string; phase: string; extension: string },
): string {
  const extension = input.extension.toLowerCase();
  if (!EXTENSION.test(extension)) {
    throw new HttpError(400, 'Invalid file extension.', 'invalid_extension');
  }
  return `${party.org_id}/${party.job_id}/${party.id}/${input.workDate}-${input.phase}.${extension}`;
}

/**
 * `recordProof` used to store whatever `storagePath` the client sent. A token
 * holder could then file another party's object (or skip the upload). The
 * recorded path must be the one this party was given to upload.
 */
export function assertOwnedProofStoragePath(
  party: ProofPartyRef,
  input: { workDate: string; phase: string; storagePath: string },
): string {
  const storagePath = input.storagePath.trim();
  const match = /^([^/]+)\/([^/]+)\/([^/]+)\/(\d{4}-\d{2}-\d{2})-(before|after)\.([a-z0-9]{2,5})$/.exec(
    storagePath,
  );
  if (!match) {
    throw new HttpError(400, 'storagePath does not match this job.', 'storage_path_mismatch');
  }
  const [, orgId, jobId, partyId, workDate, phase] = match;
  if (
    orgId !== party.org_id ||
    jobId !== party.job_id ||
    partyId !== party.id ||
    workDate !== input.workDate ||
    phase !== input.phase
  ) {
    throw new HttpError(400, 'storagePath does not match this job.', 'storage_path_mismatch');
  }
  return storagePath;
}
