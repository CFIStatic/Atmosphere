import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  RESEND_LEGACY_FROM,
  RESEND_ONBOARDING_FROM,
  RESEND_VERIFIED_FROM,
  emailDomain,
  isResendSenderRestriction,
  resendFromAddress,
  resendFromCandidates,
} from './resendFrom.js';

describe('resendFromAddress', () => {
  it('always uses hello@invites.atmosphereteam.com by default', () => {
    const prev = process.env.RESEND_FROM_EMAIL;
    delete process.env.RESEND_FROM_EMAIL;
    try {
      assert.equal(resendFromAddress('jack@jettx.ai'), RESEND_VERIFIED_FROM);
      assert.equal(resendFromAddress(null), RESEND_VERIFIED_FROM);
      assert.equal(resendFromAddress('hello@invites.atmosphereteam.com'), RESEND_VERIFIED_FROM);
    } finally {
      if (prev === undefined) delete process.env.RESEND_FROM_EMAIL;
      else process.env.RESEND_FROM_EMAIL = prev;
    }
  });

  it('honors RESEND_FROM_EMAIL on the Atmosphere verified subdomain', () => {
    const prev = process.env.RESEND_FROM_EMAIL;
    process.env.RESEND_FROM_EMAIL = 'ops@invites.atmosphereteam.com';
    try {
      assert.equal(resendFromAddress('jack@jettx.ai'), 'ops@invites.atmosphereteam.com');
    } finally {
      if (prev === undefined) delete process.env.RESEND_FROM_EMAIL;
      else process.env.RESEND_FROM_EMAIL = prev;
    }
  });

  it('honors RESEND_FROM_EMAIL on the legacy invites.jettx.ai subdomain', () => {
    const prev = process.env.RESEND_FROM_EMAIL;
    process.env.RESEND_FROM_EMAIL = 'hello@invites.jettx.ai';
    try {
      assert.equal(resendFromAddress(), 'hello@invites.jettx.ai');
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
    assert.equal(emailDomain('hello@invites.atmosphereteam.com'), 'invites.atmosphereteam.com');
    assert.equal(emailDomain('hello@invites.jettx.ai'), 'invites.jettx.ai');
    assert.equal(emailDomain('not-an-email'), '');
  });

  it('detects Resend unverified-domain and test-mode errors', () => {
    assert.equal(
      isResendSenderRestriction(
        403,
        '{"message":"The atmosphereteam.com domain is not verified. Please, add and verify your domain on https://resend.com/domains"}',
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
  it('tries Atmosphere then legacy Jettx in production', () => {
    assert.deepEqual(
      resendFromCandidates({
        configuredFrom: 'hello@atmosphereteam.com',
        allowOnboardingFallback: false,
      }),
      [RESEND_VERIFIED_FROM, RESEND_LEGACY_FROM],
    );
  });

  it('allows onboarding@resend.dev only as a last-resort non-prod fallback', () => {
    assert.deepEqual(
      resendFromCandidates({
        configuredFrom: 'hello@atmosphereteam.com',
        allowOnboardingFallback: true,
      }),
      [RESEND_VERIFIED_FROM, RESEND_LEGACY_FROM, RESEND_ONBOARDING_FROM],
    );
  });

  it('does not duplicate legacy when RESEND_FROM_EMAIL is already Jettx', () => {
    const prev = process.env.RESEND_FROM_EMAIL;
    process.env.RESEND_FROM_EMAIL = RESEND_LEGACY_FROM;
    try {
      assert.deepEqual(
        resendFromCandidates({ allowOnboardingFallback: false }),
        [RESEND_LEGACY_FROM],
      );
    } finally {
      if (prev === undefined) delete process.env.RESEND_FROM_EMAIL;
      else process.env.RESEND_FROM_EMAIL = prev;
    }
  });
});
