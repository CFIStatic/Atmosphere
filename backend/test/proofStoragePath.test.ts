import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../src/lib/errors.js';
import {
  assertOwnedProofStoragePath,
  proofObjectPath,
} from '../src/shared/proofStoragePath.js';

const party = {
  org_id: 'org-1',
  job_id: 'job-1',
  id: 'party-1',
};

test('proofObjectPath is scoped to this org, job, and party', () => {
  assert.equal(
    proofObjectPath(party, { workDate: '2026-08-05', phase: 'after', extension: 'mp4' }),
    'org-1/job-1/party-1/2026-08-05-after.mp4',
  );
});

test('assertOwnedProofStoragePath accepts the path this party was given to upload', () => {
  const path = proofObjectPath(party, { workDate: '2026-08-05', phase: 'before', extension: 'mov' });
  assert.equal(
    assertOwnedProofStoragePath(party, {
      workDate: '2026-08-05',
      phase: 'before',
      storagePath: path,
    }),
    path,
  );
});

test('assertOwnedProofStoragePath rejects another party, day, or phase', () => {
  const mismatches = [
    'org-1/job-1/party-OTHER/2026-08-05-after.mp4',
    'org-1/job-OTHER/party-1/2026-08-05-after.mp4',
    'org-OTHER/job-1/party-1/2026-08-05-after.mp4',
    'org-1/job-1/party-1/2026-08-06-after.mp4',
    'org-1/job-1/party-1/2026-08-05-before.mp4',
    'org-1/job-1/party-1/../job-OTHER/2026-08-05-after.mp4',
    'not-a-path',
  ];
  for (const storagePath of mismatches) {
    assert.throws(
      () =>
        assertOwnedProofStoragePath(party, {
          workDate: '2026-08-05',
          phase: 'after',
          storagePath,
        }),
      (err: unknown) => err instanceof HttpError && err.status === 400 && err.code === 'storage_path_mismatch',
    );
  }
});
