import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  RESEND_ONBOARDING_FROM,
  RESEND_VERIFIED_FROM,
  emailDomain,
  isResendSenderRestriction,
  resendFromAddress,
  resendFromCandidates,
} from './resendFrom.js';

describe('resendFromAddress', () => {
  it('always uses hello@invites.jettx.ai by default', () => {
    const prev = process.env.RESEND_FROM_EMAIL;
    delete process.env.RESEND_FROM_EMAIL;
    try {
      assert.equal(resendFromAddress('jack@jettx.ai'), RESEND_VERIFIED_FROM);
      assert.equal(resendFromAddress(null), RESEND_VERIFIED_FROM);
      assert.equal(resendFromAddress('hello@invites.jettx.ai'), RESEND_VERIFIED_FROM);
    } finally {
      if (prev === undefined) delete process.env.RESEND_FROM_EMAIL;
      else process.env.RESEND_FROM_EMAIL = prev;
    }
  });

  it('honors RESEND_FROM_EMAIL on the verified subdomain', () => {
    const prev = process.env.RESEND_FROM_EMAIL;
    process.env.RESEND_FROM_EMAIL = 'ops@invites.jettx.ai';
    try {
      assert.equal(resendFromAddress('jack@jettx.ai'), 'ops@invites.jettx.ai');
    } finally {
      if (prev === undefined) delete process.env.RESEND_FROM_EMAIL;
      else process.env.RESEND_FROM_EMAIL = prev;
    }
  });

  it('ignores RESEND_FROM_EMAIL on an unverified domain', () => {
    const prev = process.env.RESEND_FROM_EMAIL;
    process.env.RESEND_FROM_EMAIL = 'jack@jettx.ai';
    try {
      assert.equal(resendFromAddress(), RESEND_VERIFIED_FROM);
    } finally {
      if (prev === undefined) delete process.env.RESEND_FROM_EMAIL;
      else process.env.RESEND_FROM_EMAIL = prev;
    }
  });
});

describe('emailDomain / sender restriction', () => {
  it('reads the domain from an address', () => {
    assert.equal(emailDomain('Jack@JettX.ai'), 'jettx.ai');
    assert.equal(emailDomain('hello@invites.jettx.ai'), 'invites.jettx.ai');
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

describe('resendFromCandidates', () => {
  it('is only hello@invites.jettx.ai in production', () => {
    assert.deepEqual(
      resendFromCandidates({
        configuredFrom: 'jack@jettx.ai',
        allowOnboardingFallback: false,
      }),
      [RESEND_VERIFIED_FROM],
    );
  });

  it('allows onboarding@resend.dev only as a last-resort non-prod fallback', () => {
    assert.deepEqual(
      resendFromCandidates({
        configuredFrom: 'jack@jettx.ai',
        allowOnboardingFallback: true,
      }),
      [RESEND_VERIFIED_FROM, RESEND_ONBOARDING_FROM],
    );
  });
});
