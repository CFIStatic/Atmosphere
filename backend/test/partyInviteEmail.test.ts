import test from 'node:test';
import assert from 'node:assert/strict';
import { partyInviteEmail } from '../src/verifier/partyInviteEmail.js';

const base = {
  orgName: 'Ortiz Restoration',
  inviterName: 'Dana Ortiz',
  jobTitle: '1842 Meridian Ave — water loss',
  recipientName: 'Alex Rivera',
  recipientEmail: 'alex@riogrande.example',
  recipientHasAccount: true,
  origin: 'https://app.atmosphere.example',
  path: '/shared/tok123?email=alex%40riogrande.example',
  signupPath: '/login?mode=signup&email=alex%40riogrande.example',
};

test('the capture link is absolute when an origin is configured, and on its own line', () => {
  const { text } = partyInviteEmail(base);
  assert.ok(
    text.includes(
      '\n  https://app.atmosphere.example/shared/tok123?email=alex%40riogrande.example\n',
    ),
  );
});

test('without an origin the path still goes out rather than nothing', () => {
  const { text } = partyInviteEmail({ ...base, origin: null });
  assert.ok(text.includes('\n  /shared/tok123?email=alex%40riogrande.example\n'));
});

test('Atmosphere sends the invite; the org is named, not the From party', () => {
  const { text, subject } = partyInviteEmail(base);
  assert.ok(text.startsWith('Atmosphere invited you to capture a job for Ortiz Restoration.'));
  assert.ok(text.includes('Requested by: Dana Ortiz'));
  assert.equal(subject, 'Atmosphere: invite to capture 1842 Meridian Ave — water loss');
  assert.ok(!subject.includes('Dana Ortiz at'));
});

test('an existing account gets sign-in; a missing one gets create-with-this-address', () => {
  const has = partyInviteEmail(base).text;
  assert.ok(has.includes('You already have an Atmosphere account'));
  assert.ok(has.includes('Sign in with that account'));
  assert.ok(!has.includes('Create a free one'));

  const not = partyInviteEmail({ ...base, recipientHasAccount: false }).text;
  assert.ok(not.includes('Create a free one'));
  assert.ok(not.includes('this exact address'));
  assert.ok(not.includes('https://app.atmosphere.example/login?mode=signup'));
  assert.ok(!not.includes('You already have an Atmosphere account'));
});

test('no unsubscribe footer — and the ignore path is stated', () => {
  const { text } = partyInviteEmail(base);
  assert.ok(!/unsubscribe/i.test(text));
  assert.ok(text.includes('you can ignore it'));
});
