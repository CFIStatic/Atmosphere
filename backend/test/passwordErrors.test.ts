import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyPasswordSignIn,
  EMAIL_UNCONFIRMED_MESSAGE,
  EXISTING_ACCOUNT_MESSAGE,
  isEmailNotConfirmed,
  isObfuscatedExistingUser,
  isUserAlreadyRegistered,
} from '../src/auth/passwordErrors.js';

test('email-not-confirmed is detected from code or message', () => {
  assert.equal(isEmailNotConfirmed({ code: 'email_not_confirmed' }), true);
  assert.equal(isEmailNotConfirmed({ message: 'Email not confirmed' }), true);
  assert.equal(isEmailNotConfirmed({ message: 'Invalid login credentials' }), false);
});

test('already-registered is detected from code or message', () => {
  assert.equal(isUserAlreadyRegistered({ code: 'user_already_exists' }), true);
  assert.equal(isUserAlreadyRegistered({ message: 'User already registered' }), true);
  assert.equal(isUserAlreadyRegistered({ message: 'A user with this email address has already been registered' }), true);
  assert.equal(isUserAlreadyRegistered({ message: 'Invalid login credentials' }), false);
});

test('empty identities with no session is an existing account, not a new signup', () => {
  assert.equal(isObfuscatedExistingUser({ identities: [] }, null), true);
  assert.equal(isObfuscatedExistingUser({ identities: [{ identity_id: '1' }] }, null), false);
  assert.equal(isObfuscatedExistingUser({ identities: [] }, { access_token: 'x' }), false);
});

test('password sign-in classification separates outages, unconfirmed, and bad passwords', () => {
  assert.equal(
    classifyPasswordSignIn({
      error: null,
      hasSession: true,
      hasUser: true,
      transient: false,
    }),
    'session',
  );
  assert.equal(
    classifyPasswordSignIn({
      error: { status: 503, message: 'upstream' },
      hasSession: false,
      hasUser: false,
      transient: true,
    }),
    'transient',
  );
  assert.equal(
    classifyPasswordSignIn({
      error: { code: 'email_not_confirmed', message: 'Email not confirmed' },
      hasSession: false,
      hasUser: false,
      transient: false,
    }),
    'email_not_confirmed',
  );
  assert.equal(
    classifyPasswordSignIn({
      error: { message: 'Invalid login credentials' },
      hasSession: false,
      hasUser: false,
      transient: false,
    }),
    'invalid',
  );
});

test('user-facing copy tells them to sign in or reset, not to create another account', () => {
  assert.match(EXISTING_ACCOUNT_MESSAGE, /already exists/i);
  assert.match(EXISTING_ACCOUNT_MESSAGE, /sign in/i);
  assert.match(EXISTING_ACCOUNT_MESSAGE, /reset your password/i);
  assert.match(EMAIL_UNCONFIRMED_MESSAGE, /not confirmed/i);
  assert.match(EMAIL_UNCONFIRMED_MESSAGE, /reset your password/i);
});
