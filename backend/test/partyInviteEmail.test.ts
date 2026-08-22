import test from 'node:test';
import assert from 'node:assert/strict';
import { partyInviteEmail } from '../src/verifier/partyInviteEmail.js';

const base = {
  orgName: 'Ortiz Restoration',
  inviterName: 'Dana Ortiz',
  jobTitle: '1842 Meridian Ave — water loss',
  siteAddress: '1842 Meridian Ave, Austin, TX 78702',
  recipientName: 'Alex Rivera',
  recipientEmail: 'alex@riogrande.example',
  recipientHasAccount: true,
  origin: 'https://app.atmosphere.example',
  path: '/shared/tok123?email=alex%40riogrande.example',
  signupPath: '/signup?email=alex%40riogrande.example',
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
  const { text, subject, html } = partyInviteEmail(base);
  assert.ok(text.includes('Ortiz Restoration invited you to capture work on Atmosphere.'));
  assert.ok(text.includes('Requested by: Dana Ortiz'));
  assert.ok(text.includes('Site: 1842 Meridian Ave, Austin, TX 78702'));
  assert.equal(subject, 'Ortiz Restoration invited you to capture: 1842 Meridian Ave — water loss');
  assert.ok(html.includes('Open job on phone'));
  assert.ok(html.includes('Ortiz Restoration'));
  assert.ok(
    html.includes(
      'href="https://app.atmosphere.example/shared/tok123?email=alex%40riogrande.example"',
    ),
  );
  assert.ok(!html.includes('Or paste this link'));
  assert.ok(!html.includes('You already have an Atmosphere account'));
  assert.ok(!html.includes(base.recipientEmail));
});

test('an existing account gets no account copy; a missing one gets create-with-this-address', () => {
  const has = partyInviteEmail(base);
  assert.ok(!has.text.includes('You already have an Atmosphere account'));
  assert.ok(!has.text.includes('Sign in with that exact email'));
  assert.ok(!has.text.includes('not the office job list'));
  assert.ok(!has.html.includes('You already have an Atmosphere account'));
  assert.ok(!has.html.includes('office job list'));
  assert.ok(!has.text.includes('Create a free account with that exact address'));

  const not = partyInviteEmail({ ...base, recipientHasAccount: false });
  assert.ok(not.text.includes('Create a free account with that exact address'));
  assert.ok(not.text.includes('https://app.atmosphere.example/signup?email='));
  assert.ok(not.html.includes('Create your account'));
  assert.ok(!not.text.includes('You already have an Atmosphere account'));
});

test('no unsubscribe footer — and the ignore path is stated', () => {
  const { text } = partyInviteEmail(base);
  assert.ok(!/unsubscribe/i.test(text));
  assert.ok(text.includes('you can ignore it'));
});
