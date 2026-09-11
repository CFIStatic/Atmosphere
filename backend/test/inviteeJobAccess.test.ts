import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  assertInviteeMayRecord,
  inviteeCanOpenJob,
  inviteeEmailsMatch,
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
  assert.match(src, /requireAuth,\n  attachShareToken/);
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
