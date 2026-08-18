import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  RESEND_ONBOARDING_FROM,
  emailDomain,
  isResendSenderRestriction,
  pickResendFromAddress,
} from './resendFrom.js';

describe('pickResendFromAddress', () => {
  it('keeps jack@jettx.ai when that domain is verified', () => {
    assert.equal(
      pickResendFromAddress('jack@jettx.ai', [{ name: 'jettx.ai', status: 'verified' }]),
      'jack@jettx.ai',
    );
  });

  it('does not send as jack@jettx.ai when only a send subdomain is verified', () => {
    assert.equal(
      pickResendFromAddress('jack@jettx.ai', [
        { name: 'send.jettx.ai', status: 'verified' },
      ]),
      'invites@send.jettx.ai',
    );
  });

  it('falls back to Resend onboarding when nothing is verified', () => {
    assert.equal(
      pickResendFromAddress('jack@jettx.ai', [
        { name: 'jettx.ai', status: 'not_started' },
      ]),
      RESEND_ONBOARDING_FROM,
    );
    assert.equal(pickResendFromAddress('jack@jettx.ai', []), RESEND_ONBOARDING_FROM);
  });

  it('prefers jettx.ai over an unrelated verified domain', () => {
    assert.equal(
      pickResendFromAddress('office@other.test', [
        { name: 'unrelated.com', status: 'verified' },
        { name: 'jettx.ai', status: 'verified' },
      ]),
      'invites@jettx.ai',
    );
  });
});

describe('emailDomain / sender restriction', () => {
  it('reads the domain from an address', () => {
    assert.equal(emailDomain('Jack@JettX.ai'), 'jettx.ai');
    assert.equal(emailDomain('not-an-email'), '');
  });

  it('detects Resend unverified-domain and test-mode errors', () => {
    assert.equal(
      isResendSenderRestriction(
        403,
        '{"message":"The jettx.ai domain is not verified. Please, add and verify your domain on https://resend.com/domains"}',
      ),
      true,
    );
    assert.equal(
      isResendSenderRestriction(
        403,
        'You can only send testing emails to your own email address. To send emails to other recipients, please verify a domain',
      ),
      true,
    );
    assert.equal(isResendSenderRestriction(500, 'internal error'), false);
  });
});
