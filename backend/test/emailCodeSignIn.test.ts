import test from 'node:test';
import assert from 'node:assert/strict';
import { EMAIL_CODE_LINK_TYPE, normalizeCodeEmail } from '../src/auth/emailCodeSignIn.js';

test('normalizeCodeEmail trims and lowercases', () => {
  assert.equal(normalizeCodeEmail('  Jack@Example.COM '), 'jack@example.com');
  assert.equal(normalizeCodeEmail(undefined), '');
});

test('email codes never use a link type that creates accounts', () => {
  assert.equal(EMAIL_CODE_LINK_TYPE, 'recovery');
});
