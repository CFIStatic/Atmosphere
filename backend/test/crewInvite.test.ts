import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMayClaimCrewInvite, crewInviteSummary } from '../src/routes/crewInvite.js';
import { HttpError } from '../src/lib/errors.js';

test('only the invited email may claim a sub invite', () => {
  assert.doesNotThrow(() => assertMayClaimCrewInvite({ email: 'Sub@X.com' }, 'sub@x.com '));
  assert.throws(
    () => assertMayClaimCrewInvite({ email: 'sub@x.com' }, 'other@x.com'),
    (e: unknown) => e instanceof HttpError && e.status === 403 && e.code === 'invite_email_mismatch',
  );
  assert.throws(
    () => assertMayClaimCrewInvite({ email: 'sub@x.com' }, null),
    (e: unknown) => e instanceof HttpError && e.code === 'invite_email_mismatch',
  );
});

test('an invite with no email cannot be claimed by whoever holds the link', () => {
  assert.throws(
    () => assertMayClaimCrewInvite({ email: null }, 'anyone@x.com'),
    (e: unknown) => e instanceof HttpError && e.code === 'invite_no_email',
  );
});

test('the invite summary names the company and job, never more', () => {
  assert.deepEqual(crewInviteSummary({ email: ' Sub@X.com ' }, 'Acme GC', ' Roof '), {
    recipientEmail: 'sub@x.com',
    orgName: 'Acme GC',
    jobTitle: 'Roof',
  });
  assert.equal(crewInviteSummary({ email: null }, null, null).orgName, 'Your contractor');
});
