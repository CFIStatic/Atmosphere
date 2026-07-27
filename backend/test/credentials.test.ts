import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

/**
 * The credential vault reads its key through the shared config module, which
 * snapshots the environment at import time — so the key has to be in place
 * before the dynamic import below, not at the top of the file.
 */
process.env.ESTIMATOR_CREDENTIAL_KEY = randomBytes(32).toString('base64');

const { sealSecret, openSecret, credentialStorageAvailable, redact } = await import(
  '../src/estimator/credentials.js'
);

describe('credential vault', () => {
  it('is available once a valid key is configured', () => {
    assert.equal(credentialStorageAvailable(), true);
  });

  it('round-trips a secret', () => {
    const secret = {
      username: 'estimator@example.com',
      password: 'correct horse battery staple',
      accountId: 'acct-42',
      baseUrl: 'https://api.example.com',
    };
    assert.deepEqual(openSecret(sealSecret(secret)), secret);
  });

  it('never stores the plaintext', () => {
    const sealed = sealSecret({ apiKey: 'sk-super-secret-value' });
    const stored = `${sealed.ciphertext}${sealed.iv}${sealed.authTag}${sealed.fingerprint}`;
    assert.ok(!stored.includes('sk-super-secret-value'));
  });

  it('uses a fresh nonce, so the same secret does not produce the same row', () => {
    const a = sealSecret({ apiKey: 'same' });
    const b = sealSecret({ apiKey: 'same' });
    assert.notEqual(a.ciphertext, b.ciphertext);
    // The fingerprint is deterministic on purpose — it is how the UI shows
    // which secret is stored without revealing it.
    assert.equal(a.fingerprint, b.fingerprint);
  });

  it('refuses a tampered row rather than returning garbage', () => {
    const sealed = sealSecret({ apiKey: 'sk-original' });
    const flipped = Buffer.from(sealed.ciphertext, 'base64');
    flipped[0] ^= 0xff;

    assert.throws(
      () => openSecret({ ...sealed, ciphertext: flipped.toString('base64') }),
      /could not be decrypted/,
    );
  });
});

describe('redact', () => {
  it('strips secret material from anything headed for a log', () => {
    const cleaned = redact({
      username: 'estimator@example.com',
      password: 'hunter2',
      nested: { apiKey: 'sk-123', Authorization: 'Bearer abc', keep: 'visible' },
      list: [{ token: 't' }],
    }) as Record<string, unknown>;

    assert.equal(cleaned.username, 'estimator@example.com');
    assert.equal(cleaned.password, '[redacted]');
    const nested = cleaned.nested as Record<string, unknown>;
    assert.equal(nested.apiKey, '[redacted]');
    assert.equal(nested.Authorization, '[redacted]');
    assert.equal(nested.keep, 'visible');
    assert.equal((cleaned.list as Record<string, unknown>[])[0]!.token, '[redacted]');
  });
});
