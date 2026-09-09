import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../src/lib/errors.js';
import {
  assertOwnedProofStoragePath,
  clipIdOfStoragePath,
  mintClipId,
  proofObjectPath,
  resolveClipId,
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

/* ---- one object per recording ----------------------------------------------
   A crew stops one video and starts the next on the same job the same day.
   Each recording carries a clip id, so the second film never overwrites the
   first, and a legacy phone without one keeps the one-per-day path. */

test('proofObjectPath gives every recording its own object when a clip id is sent', () => {
  assert.equal(
    proofObjectPath(party, { workDate: '2026-09-09', phase: 'after', extension: 'webm', clipId: 'mf3k9x2abc' }),
    'org-1/job-1/party-1/2026-09-09-after-mf3k9x2abc.webm',
  );
  assert.equal(
    proofObjectPath(party, { workDate: '2026-09-09', phase: 'after', extension: 'webm', clipId: 'MF3K9X2ABC' }),
    'org-1/job-1/party-1/2026-09-09-after-mf3k9x2abc.webm',
    'clip ids are lower-cased so the path regex stays one shape',
  );
  assert.notEqual(
    proofObjectPath(party, { workDate: '2026-09-09', phase: 'after', extension: 'webm', clipId: 'aaaaaa' }),
    proofObjectPath(party, { workDate: '2026-09-09', phase: 'after', extension: 'webm', clipId: 'bbbbbb' }),
  );
  assert.equal(
    proofObjectPath(party, { workDate: '2026-09-09', phase: 'after', extension: 'webm', clipId: null }),
    'org-1/job-1/party-1/2026-09-09-after.webm',
    'no clip id → the legacy one-per-day path',
  );
  for (const bad of ['short', 'has-dash', 'has/slash', 'x'.repeat(33), '../up']) {
    assert.throws(
      () => proofObjectPath(party, { workDate: '2026-09-09', phase: 'after', extension: 'webm', clipId: bad }),
      (err: unknown) => err instanceof HttpError && err.status === 400 && err.code === 'invalid_clip_id',
      `clip id ${JSON.stringify(bad)} must be refused`,
    );
  }
});

test('clipIdOfStoragePath reads the clip id back, null for legacy paths', () => {
  assert.equal(clipIdOfStoragePath('org-1/job-1/party-1/2026-09-09-after-mf3k9x2abc.webm'), 'mf3k9x2abc');
  assert.equal(clipIdOfStoragePath('org-1/job-1/party-1/2026-09-09-after.webm'), null);
  assert.equal(clipIdOfStoragePath('garbage'), null);
});

test('assertOwnedProofStoragePath accepts a clip path for this party and can pin the clip', () => {
  const path = proofObjectPath(party, { workDate: '2026-09-09', phase: 'after', extension: 'webm', clipId: 'mf3k9x2abc' });
  assert.equal(assertOwnedProofStoragePath(party, { workDate: '2026-09-09', phase: 'after', storagePath: path }), path);
  assert.equal(
    assertOwnedProofStoragePath(party, { workDate: '2026-09-09', phase: 'after', storagePath: path, clipId: 'mf3k9x2abc' }),
    path,
  );
  const mismatches = [
    { storagePath: path, clipId: 'other0' },
    { storagePath: 'org-1/job-1/party-1/2026-09-09-after.webm', clipId: 'mf3k9x2abc' },
    { storagePath: 'org-1/job-1/party-OTHER/2026-09-09-after-mf3k9x2abc.webm' },
    { storagePath: 'org-1/job-1/party-1/2026-09-09-after-mf3k9x2abc.webm.parts/0000' },
    { storagePath: 'org-1/job-1/party-1/2026-09-09-after-MF3K9X2ABC.webm' },
  ];
  for (const input of mismatches) {
    assert.throws(
      () => assertOwnedProofStoragePath(party, { workDate: '2026-09-09', phase: 'after', ...input }),
      (err: unknown) => err instanceof HttpError && err.status === 400 && err.code === 'storage_path_mismatch',
      `${JSON.stringify(input)} must be refused`,
    );
  }
});

test('recordProof keys the live row on the storage object, so a second clip that day is a second row', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/routes/proofOfWork.ts', import.meta.url), 'utf8');
  const from = src.indexOf('export async function recordProof(');
  const to = src.indexOf('const write = existingVisible?.id', from);
  assert.ok(from > 0 && to > from, 'recordProof must look up the existing visible row before writing');
  const lookup = src.slice(from, to);
  assert.match(lookup, /\.eq\('storage_path', storagePath\)/, 'the live row is the one for this object');
  assert.doesNotMatch(
    lookup,
    /\.eq\('phase', input\.phase\)/,
    'a second film of the same phase on the same day must not replace the first',
  );
  assert.match(lookup, /\.is\('deleted_at', null\)/, 'a customer-deleted clip must not block a refilm');
  assert.match(src, /function latestOfPhase\(/, "a day's verdict follows the latest film of that phase");
  assert.match(src, /listAllVisibleProofs/, 'the job file walks every clip, not a one-page slice');
  const library = src.slice(src.indexOf('export async function listAllVisibleProofs'));
  assert.doesNotMatch(
    library.slice(0, library.indexOf('/** Event-boundary')),
    /\.limit\(/,
    'walking pages must not also cap the library',
  );
  const payload = src.slice(src.indexOf('export async function buildJobProofPayload'));
  assert.match(payload, /listAllVisibleProofs\(supabase, \{ orgId, jobId \}\)/);
});

test('a later migration drops the one-visible-phase unique index so a job file can hold many films', async () => {
  const { readFile } = await import('node:fs/promises');
  const sql = await readFile(
    new URL('../supabase/migrations/20260909192643_job_proofs_many_visible_clips.sql', import.meta.url),
    'utf8',
  );
  assert.match(sql, /drop index if exists public\.job_proofs_one_visible_phase/);
  assert.doesNotMatch(sql, /create unique index/i);
});

test('mintClipId / resolveClipId always yield a searchable recording id', () => {
  const a = mintClipId();
  const b = mintClipId();
  assert.match(a, /^[a-z0-9]{6,32}$/);
  assert.notEqual(a, b);
  assert.equal(resolveClipId('mf3k9x2abc'), 'mf3k9x2abc');
  assert.equal(resolveClipId('MF3K9X2ABC'), 'mf3k9x2abc');
  assert.match(resolveClipId(null), /^[a-z0-9]{6,32}$/);
  assert.match(resolveClipId(''), /^[a-z0-9]{6,32}$/);
  assert.match(resolveClipId(undefined), /^[a-z0-9]{6,32}$/);
});

test('a later migration adds searchable clip_id on job_proofs', async () => {
  const { readFile } = await import('node:fs/promises');
  const sql = await readFile(
    new URL('../supabase/migrations/20260909214444_job_proofs_clip_id.sql', import.meta.url),
    'utf8',
  );
  assert.match(sql, /add column if not exists clip_id text/);
  assert.match(sql, /job_proofs_org_clip_id_uidx/);
  assert.match(sql, /unique index/i);
});
