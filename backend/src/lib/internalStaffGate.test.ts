import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { otpauthUrl, randomTotpSecret, totpAt, verifyTotp } from './totp.js';
import { readStaffChallenge, signStaffChallenge } from './internalStaffChallenge.js';
import { staffFullName } from './internalStaffGate.js';
import { decryptTotpSecret, encryptTotpSecret } from '../auth/internalStaffTotpStore.js';

describe('staff name', () => {
  it('joins first and last name', () => {
    assert.equal(staffFullName('  Jack ', ' Cyganiak '), 'Jack Cyganiak');
  });
});

describe('TOTP (Microsoft Authenticator)', () => {
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
  it('starts with name + email and verifies a 6-digit authenticator code', async () => {
    const { internalStaffStartSchema, internalStaffVerifySchema } = await import('./validation.js');
    const start = internalStaffStartSchema.parse({
      firstName: 'Jack',
      lastName: 'Cyganiak',
      email: 'jack@jettx.ai',
    });
    assert.equal(start.email, 'jack@jettx.ai');
    const verify = internalStaffVerifySchema.parse({
      challenge: 'abc.def',
      code: '123456',
    });
    assert.equal(verify.code, '123456');
    assert.throws(() =>
      internalStaffVerifySchema.parse({ challenge: 'abc.def', code: '12' }),
    );
  });
});
