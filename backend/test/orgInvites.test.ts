import test from 'node:test';
import assert from 'node:assert/strict';
import { invitesAnsweredBy, inviteEmail, type InviteRow } from '../src/org/invites.js';

/**
 * Invitations. Small surface, but both halves read wrong in ways a type
 * checker cannot see: reconciliation that resurrects a revoked invite, and an
 * email whose join code is buried where it gets typed wrong.
 */

const invite = (id: string, email: string, status: InviteRow['status'] = 'pending'): InviteRow => ({
  id,
  email,
  status,
});

test('a pending invite is answered when its address joins', () => {
  const answered = invitesAnsweredBy(
    [invite('a', 'sam@ortiz.com'), invite('b', 'kai@ortiz.com')],
    ['dana@ortiz.com', 'sam@ortiz.com'],
  );
  assert.deepEqual(answered, ['a']);
});

test('matching ignores case and stray whitespace, both ways round', () => {
  const answered = invitesAnsweredBy(
    [invite('a', ' Sam@Ortiz.com ')],
    ['sam@ortiz.com  '],
  );
  assert.deepEqual(answered, ['a']);
});

test('a revoked invite stays revoked even when the person joins anyway', () => {
  // They still had the code — revoking is bookkeeping, not access control —
  // and "we withdrew it and they came in regardless" is the sequence worth
  // being able to see. Marking it joined would erase it.
  const answered = invitesAnsweredBy(
    [invite('a', 'sam@ortiz.com', 'revoked'), invite('b', 'sam@ortiz.com', 'joined')],
    ['sam@ortiz.com'],
  );
  assert.deepEqual(answered, []);
});

test('the email is from Atmosphere, names the org, and the code stands alone', () => {
  const mail = inviteEmail({
    orgName: 'Ortiz Restoration',
    inviterName: 'Dana Ortiz',
    joinCode: 'ORTIZ-4481',
    origin: 'https://app.atmosphere.example',
  });

  assert.equal(mail.subject, 'Atmosphere: invite to join Ortiz Restoration');
  assert.ok(mail.text.startsWith('Atmosphere invited you to join Ortiz Restoration.'));
  assert.ok(mail.text.includes('Requested by: Dana Ortiz'));
  // Read off a phone, typed into a laptop: the code must sit alone.
  assert.ok(
    mail.text.split('\n').some((line) => line.trim() === 'ORTIZ-4481'),
    mail.text,
  );
  assert.match(mail.text, /app\.atmosphere\.example\/signup\?intent=join/);
  assert.match(mail.text, /Link to office account/);
  // A workplace invitation, not marketing: no unsubscribe furniture.
  assert.ok(!/unsubscribe/i.test(mail.text));
});

test('no configured origin still yields usable steps', () => {
  const mail = inviteEmail({ orgName: 'Ortiz', inviterName: null, joinCode: 'X-1', origin: null });
  assert.match(mail.text, /Open Atmosphere and create an account/);
  assert.equal(mail.subject, 'Atmosphere: invite to join Ortiz');
  assert.ok(!mail.text.includes('Requested by:'));
});

test('a note from the inviter is quoted, not paraphrased', () => {
  const mail = inviteEmail({
    orgName: 'Ortiz',
    inviterName: 'Dana',
    joinCode: 'X-1',
    note: 'Starting Monday on the Cedar Ridge job',
  });
  assert.match(mail.text, /"Starting Monday on the Cedar Ridge job"/);
});
