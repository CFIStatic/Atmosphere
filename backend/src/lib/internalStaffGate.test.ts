import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { otpauthUrl, randomTotpSecret, totpAt, verifyTotp } from './totp.js';
import { readStaffChallenge, signStaffChallenge } from './internalStaffChallenge.js';
import { fallbackStaffNames, resolveStaffNames, staffFullName } from './internalStaffGate.js';
import { decryptTotpSecret, encryptTotpSecret } from '../auth/internalStaffTotpStore.js';
import { allowlistedAnalyticsScope } from './analyticsAccess.js';

describe('staff name', () => {
  it('joins first and last name', () => {
    assert.equal(staffFullName('  Jack ', ' Cyganiak '), 'Jack Cyganiak');
  });

  it('reuses a saved display name when present', () => {
    assert.deepEqual(
      resolveStaffNames({}, { firstName: 'Jack', lastName: 'Cyganiak' }, 'jack@jettx.ai'),
      { firstName: 'Jack', lastName: 'Cyganiak' },
    );
    assert.equal(fallbackStaffNames('alex.rivera@company.com').firstName, 'alex rivera');
  });
});

describe('staff allowlist (invite gate)', () => {
  it('treats jack@jettx.ai case-insensitively as internal staff', () => {
    assert.equal(allowlistedAnalyticsScope('jack@jettx.ai'), 'internal');
    assert.equal(allowlistedAnalyticsScope('Jack@jettx.ai'), 'internal');
    assert.equal(allowlistedAnalyticsScope('JACK@JETTX.AI'), 'internal');
    assert.equal(allowlistedAnalyticsScope('stranger@example.com'), null);
  });
});

describe('TOTP helpers (legacy enrollment storage)', () => {
  it('verifies a code from the same secret and time window', () => {
    const secret = randomTotpSecret();
    const now = 1_700_000_000;
    const { code, counter } = totpAt(secret, now);
    assert.match(code, /^\d{6}$/);
    assert.equal(verifyTotp(secret, code, { nowSec: now }).ok, true);
    assert.equal(verifyTotp(secret, code, { nowSec: now, minCounter: counter }).ok, false);
    assert.equal(verifyTotp(secret, '000000', { nowSec: now }).ok, false);
  });

  it('builds an otpauth URL Microsoft Authenticator can scan', () => {
    const url = otpauthUrl('jack@jettx.ai', 'JBSWY3DPEHPK3PXP');
    assert.match(url, /^otpauth:\/\/totp\//);
    assert.match(url, /issuer=Atmosphere%20Internal/);
    assert.match(url, /digits=6/);
    assert.match(url, /period=30/);
  });

  it('matches the RFC 6238 SHA-1 6-digit vector', () => {
    // Secret is ASCII "12345678901234567890" (RFC 6238 appendix B).
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    const { code } = totpAt(secret, 59);
    assert.equal(code, '287082');
    assert.equal(verifyTotp(secret, '287082', { nowSec: 59 }).ok, true);
  });

  it('round-trips the encrypted authenticator secret', () => {
    const secret = randomTotpSecret();
    const sealed = encryptTotpSecret(secret);
    assert.equal(decryptTotpSecret(sealed), secret);
    assert.notEqual(sealed.cipher, secret);
  });
});

describe('staff challenge token', () => {
  it('signs and reads an enroll challenge', () => {
    const token = signStaffChallenge({
      email: 'jack@jettx.ai',
      firstName: 'Jack',
      lastName: 'Cyganiak',
      enrolled: false,
      secret: 'JBSWY3DPEHPK3PXP',
    });
    const parsed = readStaffChallenge(token);
    assert.ok(parsed);
    assert.equal(parsed?.email, 'jack@jettx.ai');
    assert.equal(parsed?.enrolled, false);
    assert.equal(parsed?.secret, 'JBSWY3DPEHPK3PXP');
    assert.equal(readStaffChallenge('not-a-token'), null);
  });
});

describe('internal staff login schema', () => {
  it('accepts Platform email + password and invite-request identity', async () => {
    const { internalStaffStartSchema, internalStaffVerifySchema } = await import('./validation.js');
    const start = internalStaffStartSchema.parse({
      firstName: 'Jack',
      lastName: 'Cyganiak',
      email: 'Jack@jettx.ai',
    });
    assert.equal(start.email, 'jack@jettx.ai');
    const returning = internalStaffStartSchema.parse({ email: 'jack@jettx.ai' });
    assert.equal(returning.firstName, '');
    assert.equal(returning.lastName, '');
    const verify = internalStaffVerifySchema.parse({
      email: 'Jack@jettx.ai',
      password: 'platform-password',
    });
    assert.equal(verify.email, 'jack@jettx.ai');
    assert.equal(verify.password, 'platform-password');
    assert.throws(() =>
      internalStaffVerifySchema.parse({ email: 'jack@jettx.ai', password: 'short' }),
    );
    assert.throws(() =>
      internalStaffVerifySchema.parse({ email: 'jack@jettx.ai', code: '123456' }),
    );
  });
});
