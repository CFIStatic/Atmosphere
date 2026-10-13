import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCodeEmail } from '../src/auth/emailCodeSignIn.js';

test('normalizeCodeEmail trims and lowercases', () => {
  assert.equal(normalizeCodeEmail('  Jack@Example.COM '), 'jack@example.com');
  assert.equal(normalizeCodeEmail(undefined), '');
});
