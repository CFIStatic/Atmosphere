import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isAlreadyRegisteredMessage,
  isEmailUnconfirmedError,
  isUnconfirmedAuthUser,
  signupDecisionForExistingUser,
  EMAIL_TAKEN_MESSAGE,
  emailTakenError,
} from './passwordAccount.js';

describe('password account errors', () => {
  it('recognizes an already-registered admin createUser message', () => {
    assert.equal(isAlreadyRegisteredMessage('User already registered'), true);
    assert.equal(isAlreadyRegisteredMessage('A user with this email address has already been registered'), true);
    assert.equal(isAlreadyRegisteredMessage('Invalid API key'), false);
  });

  it('recognizes an unconfirmed-email Auth error', () => {
    assert.equal(isEmailUnconfirmedError({ code: 'email_not_confirmed', message: 'Email not confirmed' }), true);
    assert.equal(isEmailUnconfirmedError({ message: 'Email not confirmed' }), true);
    assert.equal(isEmailUnconfirmedError({ message: 'Invalid login credentials' }), false);
  });

  it('treats a user without confirmed_at as unconfirmed', () => {
    assert.equal(isUnconfirmedAuthUser({ email_confirmed_at: null, confirmed_at: null }), true);
    assert.equal(isUnconfirmedAuthUser({ email_confirmed_at: '2026-08-18T18:00:00Z' }), false);
  });

  it('lets unconfirmed leftover rows continue through signup so they can be claimed', () => {
    assert.equal(
      signupDecisionForExistingUser({ email_confirmed_at: null, confirmed_at: null }, false),
      'continue',
    );
    assert.equal(signupDecisionForExistingUser(null, false), 'continue');
  });

  it('signs in when Create account is used with the existing password', () => {
    assert.equal(
      signupDecisionForExistingUser({ email_confirmed_at: '2026-08-18T18:00:00Z' }, true),
      'signin',
    );
  });

  it('returns email_taken for a confirmed account with a different password', () => {
    assert.equal(
      signupDecisionForExistingUser({ email_confirmed_at: '2026-08-18T18:00:00Z' }, false),
      'email_taken',
    );
    const err = emailTakenError();
    assert.equal(err.status, 409);
    assert.equal(err.code, 'email_taken');
    assert.equal(err.message, EMAIL_TAKEN_MESSAGE);
  });
});
