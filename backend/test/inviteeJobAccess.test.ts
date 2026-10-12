import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  assertInviteeMayRecord,
  inviteeCanOpenJob,
  inviteeEmailsMatch,
  invitedPartyForJob,
  mergeSharedTodayJobs,
  sharedJobsOnly,
  normalizeInviteEmail,
  partiesInvitedToEmail,
} from '../src/shared/inviteeJobAccess.js';
import { HttpError } from '../src/lib/errors.js';

const ALICE = 'alice@sub.example';
const BOB = 'bob@other.example';

const jobA = {
  id: 'party-a',
  job_id: 'job-a',
  email: 'Alice@sub.example',
  revoked_at: null,
};
const jobB = {
  id: 'party-b',
  job_id: 'job-b',
  email: BOB,
  revoked_at: null,
};
const revokedA2 = {
  id: 'party-a2',
  job_id: 'job-a2',
  email: ALICE,
  revoked_at: '2026-09-01T00:00:00Z',
};

test('invitee A cannot list job B that was sent to someone else', () => {
  const listed = partiesInvitedToEmail([jobA, jobB, revokedA2], ALICE);
  assert.deepEqual(
    listed.map((p) => p.job_id),
    ['job-a'],
  );
  assert.equal(inviteeCanOpenJob(listed.map((p) => p.job_id), 'job-b'), false);
  assert.equal(inviteeCanOpenJob(listed.map((p) => p.job_id), 'job-a'), true);
});

test('email alone does not unlock another recipient’s invite', () => {
  assert.equal(inviteeEmailsMatch(ALICE, BOB), false);
  assert.equal(inviteeEmailsMatch(ALICE, 'ALICE@sub.example'), true);
  assert.equal(normalizeInviteEmail('  Bob@Other.Example '), BOB);
  assert.deepEqual(partiesInvitedToEmail([jobA, jobB], 'not-an-invite@example'), []);
});

test('recording requires an account whose email matches the invited party', () => {
  assert.throws(
    () => assertInviteeMayRecord({ email: ALICE }, null),
    (err: unknown) => err instanceof HttpError && err.code === 'account_required' && err.status === 401,
  );
  assert.throws(
    () => assertInviteeMayRecord({ email: ALICE }, BOB),
    (err: unknown) => err instanceof HttpError && err.code === 'invite_email_mismatch' && err.status === 403,
  );
  assert.doesNotThrow(() => assertInviteeMayRecord({ email: ALICE }, ALICE));
  assert.doesNotThrow(() => assertInviteeMayRecord({ email: ALICE }, 'Alice@sub.example'));
});

test('job-share recording routes require a matching account', () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../src/routes/sharedJobs.ts'),
    'utf8',
  );
  assert.match(src, /assertInviteeAccount\(req, party\)/);
  assert.match(src, /requireAuth,\n {2}attachShareToken/);
});

test('field-app Today does not list org jobs for capture invitees', () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../src/routes/fieldApp.ts'),
    'utf8',
  );
  assert.match(src, /listInviteeToday/);
  assert.match(src, /access: 'invitee'/);
  assert.match(src, /claimInvitedPartiesForUser/);
});

test('a signed-in sub files on the job under their own invite', () => {
  const older = { ...jobA, id: 'party-a-old', created_at: '2026-10-01T00:00:00Z' };
  const newer = { ...jobA, id: 'party-a-new', created_at: '2026-10-05T00:00:00Z' };
  const parties = [newer, jobB, older, { ...jobA, id: 'gone', revoked_at: '2026-10-02T00:00:00Z' }];
  assert.equal(invitedPartyForJob(parties, 'job-a', ALICE)?.id, 'party-a-old');
  assert.equal(invitedPartyForJob(parties, 'job-a', BOB), null, 'never another recipient');
  assert.equal(invitedPartyForJob(parties, 'job-b', ALICE), null, 'never a job not shared with them');
  assert.equal(invitedPartyForJob(parties, null, ALICE), null);
});

test('Today lists jobs shared with a sub after their own jobs, once each', () => {
  const merged = mergeSharedTodayJobs(
    [{ id: 'own-1' }, { id: 'both' }],
    [
      { id: 'both', shared: true },
      { id: 'shared-1', shared: true },
      { id: 'shared-1', shared: true },
    ],
  );
  assert.deepEqual(
    merged.map((job) => job.id),
    ['own-1', 'both', 'shared-1'],
  );
});

test('field-app filing falls back to the invite for shared jobs', () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../src/routes/fieldApp.ts'),
    'utf8',
  );
  assert.match(src, /err\.code === 'job_not_found'\) return inviteeProofParty\(req\)/);
  assert.match(src, /err\.code === 'no_organization'\) return inviteeProofParty\(req\)/);
  assert.match(src, /assertInviteeAccount\(req, party\)/);
  assert.match(src, /mergeSharedTodayJobs\(out, shared\)/);
});

test('a GC never sees his own jobs as "shared", and deleted job files never come back', () => {
  // jack@jettx.ai: Field Capture adds a general_contractor job_parties row with his
  // email on every job he films, and he invited his own email as a sub on a few.
  const OWN = 'org-jettx';
  const OTHER = 'org-other-gc';
  const jobs = [
    { id: 'own-live', org_id: OWN },
    { id: 'own-deleted', org_id: OWN },
    { id: 'other-live', org_id: OTHER },
    { id: 'other-deleted', org_id: OTHER },
  ];
  const tomb = new Map([
    [OWN, new Set(['own-deleted'])],
    [OTHER, new Set(['other-deleted'])],
  ]);
  assert.deepEqual(sharedJobsOnly(jobs, [OWN], tomb).map((j) => j.id), ['other-live']);
  // A homeowner or sub with no workspace still gets every live shared job.
  assert.deepEqual(sharedJobsOnly(jobs, [], tomb).map((j) => j.id), ['own-live', 'other-live']);
  const src = readFileSync(new URL('../src/routes/fieldApp.ts', import.meta.url), 'utf8');
  assert.match(src, /sharedJobsOnly\(/);
});
