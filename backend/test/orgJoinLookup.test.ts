import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeJoinCode, LookupThrottle } from '../src/org/joinLookup.js';

/**
 * The anonymous join-code lookup behind the invite QR code. Two pure pieces:
 * the format gate that decides whether an input is even worth a database
 * query, and the throttle that makes scanning the code space pointless.
 */

test('a code survives normalization the way people actually type it', () => {
  // Read off a phone screen, typed with stray spaces and lowercase.
  assert.equal(normalizeJoinCode('  8f3a9c2b '), '8F3A9C2B');
  assert.equal(normalizeJoinCode('8F3A9C2B'), '8F3A9C2B');
});

test('inputs that could never be a join code are rejected outright', () => {
  assert.equal(normalizeJoinCode('short'), null); // 5 chars — below minimum
  assert.equal(normalizeJoinCode('THIRTEENCHARS'), null); // above maximum
  assert.equal(normalizeJoinCode('8F3A-9C2B'), null); // punctuation
  assert.equal(normalizeJoinCode('8F3A 9C2B'), null); // inner whitespace
  assert.equal(normalizeJoinCode(''), null);
  assert.equal(normalizeJoinCode(null), null);
  assert.equal(normalizeJoinCode(42), null);
  // SQL wildcards especially: the route may match case-insensitively, and a
  // code containing % or _ must never reach a LIKE-shaped query.
  assert.equal(normalizeJoinCode('%%%%%%%%'), null);
  assert.equal(normalizeJoinCode('________'), null);
});

test('the throttle lets a person through and stops a scanner', () => {
  const throttle = new LookupThrottle(3, 60_000);
  const t0 = 1_000_000;

  assert.ok(throttle.allow('1.2.3.4', t0));
  assert.ok(throttle.allow('1.2.3.4', t0 + 1));
  assert.ok(throttle.allow('1.2.3.4', t0 + 2));
  // Fourth attempt inside the window — over the line.
  assert.equal(throttle.allow('1.2.3.4', t0 + 3), false);
  // A different address is unaffected by the scanner's behavior.
  assert.ok(throttle.allow('5.6.7.8', t0 + 3));
});

test('the window resets and the person is welcome again', () => {
  const throttle = new LookupThrottle(1, 60_000);
  const t0 = 1_000_000;

  assert.ok(throttle.allow('1.2.3.4', t0));
  assert.equal(throttle.allow('1.2.3.4', t0 + 59_999), false);
  assert.ok(throttle.allow('1.2.3.4', t0 + 60_000));
});
