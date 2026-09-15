import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretRevokeOutcome } from '../src/auth/revokeUserSessions.js';

test('interpretRevokeOutcome succeeds when mint, redeem, and signOut clear', () => {
  assert.deepEqual(
    interpretRevokeOutcome({
      hasUser: true,
      hasEmail: true,
      hashedToken: 'abc',
      accessToken: 'jwt',
      signOutError: null,
    }),
    { ok: true },
  );
});

test('interpretRevokeOutcome reports missing user or email', () => {
  assert.equal(
    interpretRevokeOutcome({
      hasUser: false,
      hasEmail: false,
      hashedToken: null,
      accessToken: null,
      signOutError: null,
    }).ok,
    false,
  );
  assert.equal(
    interpretRevokeOutcome({
      hasUser: true,
      hasEmail: false,
      hashedToken: null,
      accessToken: null,
      signOutError: null,
    }).reason,
    'user_has_no_email',
  );
});

test('interpretRevokeOutcome reports mint, redeem, or signOut failures', () => {
  assert.equal(
    interpretRevokeOutcome({
      hasUser: true,
      hasEmail: true,
      hashedToken: null,
      accessToken: null,
      signOutError: null,
    }).reason,
    'mint_failed',
  );
  assert.equal(
    interpretRevokeOutcome({
      hasUser: true,
      hasEmail: true,
      hashedToken: 't',
      accessToken: null,
      signOutError: null,
    }).reason,
    'redeem_failed',
  );
  assert.equal(
    interpretRevokeOutcome({
      hasUser: true,
      hasEmail: true,
      hashedToken: 't',
      accessToken: 'jwt',
      signOutError: 'boom',
    }).reason,
    'boom',
  );
});
