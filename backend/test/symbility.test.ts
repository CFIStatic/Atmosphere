import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

/**
 * The Symbility connection stack.
 *
 * The properties worth a test are the credential ones — a sealed password that
 * opens for the wrong user, or a grant that survives with no scopes, is the
 * kind of failure that never shows up in a demo and always shows up in an
 * incident. The mock driver's three outcomes are covered because the routes
 * branch on all three.
 */

// Config snapshots the environment at import time, so the key goes in first.
process.env.SYMBILITY_ENC_KEY = randomBytes(32).toString('base64');

const {
  createGrant,
  grantIsLive,
  createSymbilityDriver,
  isSymbilityVaultConfigured,
  sealSymbilityCredential,
  openSymbilityCredential,
} = await import('../src/estimator/symbility/index.js');

describe('symbility credential vault', () => {
  it('is configured once a key is present', () => {
    assert.equal(isSymbilityVaultConfigured(), true);
  });

  it('round-trips a password for the same user', () => {
    const sealed = sealSymbilityCredential('correct horse battery staple', 'user-1');
    assert.equal(openSymbilityCredential(sealed, 'user-1'), 'correct horse battery staple');
  });

  it('refuses to open a row copied to another user', () => {
    const sealed = sealSymbilityCredential('secret', 'user-1');
    assert.throws(() => openSymbilityCredential(sealed, 'user-2'));
  });

  it('refuses to seal an empty credential', () => {
    assert.throws(() => sealSymbilityCredential('', 'user-1'));
  });

  it('two seals of the same password share no ciphertext', () => {
    const a = sealSymbilityCredential('same-password', 'user-1');
    const b = sealSymbilityCredential('same-password', 'user-1');
    assert.notEqual(a.ciphertext, b.ciphertext);
    assert.notEqual(a.salt, b.salt);
  });
});

describe('symbility consent grant', () => {
  it('drops unknown scopes and refuses an empty grant', () => {
    const grant = createGrant({
      userId: 'u',
      orgId: null,
      username: 'dana',
      scopes: ['read_profile', 'launch_missiles' as never],
    });
    assert.deepEqual(grant.scopes, ['read_profile']);
    assert.throws(() =>
      createGrant({ userId: 'u', orgId: null, username: 'dana', scopes: ['nope' as never] }),
    );
  });

  it('is live until it expires or is revoked', () => {
    const grant = createGrant({
      userId: 'u',
      orgId: null,
      username: 'dana',
      scopes: ['read_profile'],
      days: 1,
    });
    assert.equal(grantIsLive(grant), true);
    assert.equal(grantIsLive({ ...grant, revokedAt: new Date().toISOString() }), false);
    assert.equal(grantIsLive({ ...grant, expiresAt: new Date(Date.now() - 1000).toISOString() }), false);
    assert.equal(grantIsLive(null), false);
  });
});

describe('symbility mock driver', () => {
  const grant = createGrant({
    userId: 'u',
    orgId: null,
    username: 'dana@ortiz.com',
    scopes: ['read_profile'],
  });

  it('connects and says plainly that it is a mock', async () => {
    const driver = createSymbilityDriver('mock');
    const result = await driver.connect({ username: 'dana@ortiz.com', password: 'pw' }, grant);
    assert.equal(result.status, 'connected');
    if (result.status === 'connected') {
      assert.match(result.profile.companyName ?? '', /Mock/);
      assert.equal(result.session.kind, 'mock');
    }
  });

  it('walks the MFA path: challenge first, then a code passes', async () => {
    const driver = createSymbilityDriver('mock');
    const first = await driver.connect({ username: 'd', password: 'needs-mfa' }, grant);
    assert.equal(first.status, 'mfa_required');
    const second = await driver.connect(
      { username: 'd', password: 'needs-mfa', mfaCode: '123456' },
      grant,
    );
    assert.equal(second.status, 'connected');
  });

  it('reports a bad login as failed, not thrown', async () => {
    const driver = createSymbilityDriver('mock');
    const result = await driver.connect({ username: 'd', password: 'wrong' }, grant);
    assert.equal(result.status, 'failed');
  });

  it('refuses the web driver while automation is disabled', () => {
    assert.throws(() => createSymbilityDriver('web'), /disabled/);
  });
});
