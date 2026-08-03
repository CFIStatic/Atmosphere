import test from 'node:test';
import assert from 'node:assert/strict';

process.env.INTEGRATIONS_OAUTH_KEY ??= 'test-key-for-sealing-oauth-grants-only';

const { seal, open } = await import('../src/lib/integrations/oauthVault.js');

/**
 * A refresh token is the strongest credential this system holds: long-lived,
 * and it grants whatever the connecting user could do in their Salesforce.
 * These tests defend the two properties that make storing one defensible.
 */

test('a sealed grant round-trips', () => {
  const token = '5Aep861_refresh_token_example_value';
  assert.equal(open(seal(token)), token);
});

test('sealing is non-deterministic, so identical tokens differ on disk', () => {
  // A fresh IV per seal. Without it, two orgs connecting the same sandbox
  // would produce identical ciphertext, which tells an observer with database
  // access that the two are related before anything is ever decrypted.
  const token = 'the-same-token';
  const a = seal(token);
  const b = seal(token);
  assert.notEqual(a.ciphertext, b.ciphertext);
  assert.notEqual(a.iv, b.iv);
  assert.equal(open(a), open(b));
});

test('a tampered grant fails to decrypt rather than yielding bytes', () => {
  // The reason for GCM over CBC. A row an attacker has edited must throw here,
  // not hand back attacker-chosen plaintext that we would then send to
  // Salesforce as a bearer token.
  const sealed = seal('real-token');

  const flipped = Buffer.from(sealed.ciphertext, 'base64');
  flipped[0] ^= 0xff;
  assert.throws(() => open({ ...sealed, ciphertext: flipped.toString('base64') }));

  const badTag = Buffer.from(sealed.tag, 'base64');
  badTag[0] ^= 0xff;
  assert.throws(() => open({ ...sealed, tag: badTag.toString('base64') }));
});

test('the ciphertext does not contain the token', () => {
  // Obvious, and worth pinning: a refactor that accidentally stored plaintext
  // alongside the sealed copy would pass every other test in this file.
  const token = 'refresh-token-plainly-visible';
  const sealed = seal(token);
  const blob = JSON.stringify(sealed);
  assert.ok(!blob.includes(token));
});
