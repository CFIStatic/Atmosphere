import test from 'node:test';
import assert from 'node:assert/strict';
import { invitesAnsweredBy, inviteEmail, type InviteRow } from '../src/org/invites.js';

/**
 * Invitations. Small surface, but both halves read wrong in ways a type
 * checker cannot see: reconciliation that resurrects a revoked invite, and
 * an email that still tells someone to type a join code.
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
  const answered = invitesAnsweredBy(
    [invite('a', 'sam@ortiz.com', 'revoked'), invite('b', 'sam@ortiz.com', 'joined')],
    ['sam@ortiz.com'],
  );
  assert.deepEqual(answered, []);
});

test('the email is from Atmosphere, names the org, and has no join code', () => {
  const mail = inviteEmail({
    orgName: 'Ortiz Restoration',
    inviterName: 'Dana Ortiz',
    origin: 'https://app.atmosphere.example',
  });

  assert.equal(mail.subject, 'Atmosphere: invite to join Ortiz Restoration');
  assert.ok(mail.text.startsWith('Atmosphere invited you to join Ortiz Restoration.'));
  assert.ok(mail.text.includes('Requested by: Dana Ortiz'));
  assert.doesNotMatch(mail.text, /ORTIZ-4481/);
  assert.doesNotMatch(mail.text, /join code/i);
  assert.match(mail.text, /app\.atmosphere\.example\/signup\?intent=join/);
  assert.match(mail.html, /Create your account/);
  assert.ok(!/unsubscribe/i.test(mail.text));
});

test('the join email also points at Field Capture on the web', () => {
  const mail = inviteEmail({
    orgName: 'Jettx LLC',
    inviterName: 'Jack Cyganiak',
    origin: 'https://atmosphere-web-production.up.railway.app',
    fieldCaptureOrigin: 'https://field-capture-production.up.railway.app',
  });
  assert.match(mail.text, /field-capture-production\.up\.railway\.app/);
  assert.match(mail.html, /Open Field Capture/);
  assert.match(mail.html, /field-capture-production\.up\.railway\.app/);
});

test('no configured origin still yields usable steps', () => {
  const mail = inviteEmail({ orgName: 'Ortiz', inviterName: null, origin: null });
  assert.match(mail.text, /Open Atmosphere and create an account/);
  assert.equal(mail.subject, 'Atmosphere: invite to join Ortiz');
  assert.ok(!mail.text.includes('Requested by:'));
});

test('a note from the inviter is quoted, not paraphrased', () => {
  const mail = inviteEmail({
    orgName: 'Ortiz',
    inviterName: 'Dana',
    note: 'Starting Monday on the Cedar Ridge job',
  });
  assert.match(mail.text, /"Starting Monday on the Cedar Ridge job"/);
  assert.match(mail.html, /"Starting Monday on the Cedar Ridge job"/);
});
