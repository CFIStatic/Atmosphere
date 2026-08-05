import test from 'node:test';
import assert from 'node:assert/strict';
import { shareEmail } from '../src/verifier/shareEmail.js';

/**
 * The words a reviewer receives. What earns a test is anything that, worded
 * wrong, generates a phone call: a link that refuses for the forwarded-to
 * colleague, instructions for an account the person does not have, an expiry
 * that is not where they will look for it.
 */

const base = {
  orgName: 'Ortiz Restoration',
  sharerName: 'Dana Ortiz',
  jobTitle: 'Cedar Ridge — storm damage',
  recipientEmail: 'r.calloway@alliancemutual.com',
  recipientHasAccount: true,
  origin: 'https://app.atmosphere.example',
  path: '/verifier/shared/tok123',
  expiresAt: '2026-09-06T00:00:00Z',
};

test('the link is absolute when an origin is configured, and on its own line', () => {
  const { text } = shareEmail(base);
  assert.ok(text.includes('\n  https://app.atmosphere.example/verifier/shared/tok123\n'));
});

test('without an origin the path still goes out rather than nothing', () => {
  const { text } = shareEmail({ ...base, origin: null });
  assert.ok(text.includes('\n  /verifier/shared/tok123\n'));
});

test('the pin is stated: the recipient address, by name', () => {
  const { text } = shareEmail(base);
  assert.ok(text.includes('signed in to Atmosphere as r.calloway@alliancemutual.com'));
});

test('an existing account gets sign-in; a missing one gets create-with-this-address', () => {
  const has = shareEmail(base).text;
  assert.ok(has.includes('Sign in with that account'));
  assert.ok(!has.includes('Create a free one'));

  const not = shareEmail({ ...base, recipientHasAccount: false }).text;
  assert.ok(not.includes('Create a free one'));
  assert.ok(not.includes('this exact address'));
  assert.ok(!not.includes('Sign in with that account'));
});

test('expiry is a date; no expiry says who can end it instead', () => {
  assert.ok(shareEmail(base).text.includes('expires on 2026-09-06'));
  const open = shareEmail({ ...base, expiresAt: null }).text;
  assert.ok(open.includes('stays live until Ortiz Restoration revokes it'));
});

test('the subject names the sharer and the job; both degrade to the org alone', () => {
  assert.equal(
    shareEmail(base).subject,
    'Dana Ortiz at Ortiz Restoration shared evidence for Cedar Ridge — storm damage on Atmosphere',
  );
  assert.equal(
    shareEmail({ ...base, sharerName: null, jobTitle: null }).subject,
    'Ortiz Restoration shared evidence on Atmosphere',
  );
});

test('no unsubscribe footer, no marketing dress — and the ignore path is stated', () => {
  const { text } = shareEmail(base);
  assert.ok(!/unsubscribe/i.test(text));
  assert.ok(text.includes('you can ignore it'));
});
