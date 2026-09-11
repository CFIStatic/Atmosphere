import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  RESEND_ONBOARDING_FROM,
  RESEND_VERIFIED_FROM,
  emailDomain,
  isResendSenderRestriction,
  pickResendFromAddress,
  pickResendFromAddressForList,
  resendFromCandidates,
} from './resendFrom.js';

describe('pickResendFromAddress', () => {
  it('keeps jack@jettx.ai when only the apex domain is verified', () => {
    assert.equal(
      pickResendFromAddress('jack@jettx.ai', [{ name: 'jettx.ai', status: 'verified' }]),
      'jack@jettx.ai',
    );
  });

  it('prefers hello@invites.jettx.ai when both apex and invites are verified', () => {
    assert.equal(
      pickResendFromAddress('jack@jettx.ai', [
        { name: 'jettx.ai', status: 'verified' },
        { name: 'invites.jettx.ai', status: 'verified' },
      ]),
      RESEND_VERIFIED_FROM,
    );
  });

  it('sends as hello@invites.jettx.ai when that subdomain is verified', () => {
    assert.equal(
      pickResendFromAddress('jack@jettx.ai', [
        { name: 'invites.jettx.ai', status: 'verified' },
      ]),
      RESEND_VERIFIED_FROM,
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

  it('uses the verified invites subdomain when nothing is listed as verified', () => {
    assert.equal(
      pickResendFromAddress('jack@jettx.ai', [
        { name: 'jettx.ai', status: 'not_started' },
      ]),
      RESEND_VERIFIED_FROM,
    );
    assert.equal(pickResendFromAddress('jack@jettx.ai', []), RESEND_VERIFIED_FROM);
  });

  it('prefers invites.jettx.ai over an unrelated verified domain', () => {
    assert.equal(
      pickResendFromAddress('office@other.test', [
        { name: 'unrelated.com', status: 'verified' },
        { name: 'invites.jettx.ai', status: 'verified' },
      ]),
      RESEND_VERIFIED_FROM,
    );
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

describe('pickResendFromAddressForList', () => {
  it('uses hello@invites.jettx.ai when the API key cannot list domains', () => {
    assert.equal(
      pickResendFromAddressForList('jack@jettx.ai', {
        ok: false,
        restricted: true,
        domains: [],
      }),
      RESEND_VERIFIED_FROM,
    );
  });

  it('uses hello@invites.jettx.ai when the list succeeds with no verified domain', () => {
    assert.equal(
      pickResendFromAddressForList('jack@jettx.ai', {
        ok: true,
        restricted: false,
        domains: [],
      }),
      RESEND_VERIFIED_FROM,
    );
  });
});

describe('resendFromCandidates', () => {
  it('leads with hello@invites.jettx.ai even when pick would use the apex', () => {
    assert.deepEqual(
      resendFromCandidates({
        configuredFrom: 'jack@jettx.ai',
        listed: {
          ok: true,
          restricted: false,
          domains: [{ name: 'jettx.ai', status: 'verified' }],
        },
        allowOnboardingFallback: false,
      }),
      [RESEND_VERIFIED_FROM, 'jack@jettx.ai'],
    );
  });

  it('omits onboarding@resend.dev when production forbids it', () => {
    assert.deepEqual(
      resendFromCandidates({
        configuredFrom: 'jack@jettx.ai',
        listed: { ok: false, restricted: true, domains: [] },
        allowOnboardingFallback: false,
      }),
      [RESEND_VERIFIED_FROM],
    );
  });

  it('allows onboarding@resend.dev only as a last-resort non-prod fallback', () => {
    assert.deepEqual(
      resendFromCandidates({
        configuredFrom: 'jack@jettx.ai',
        listed: { ok: false, restricted: true, domains: [] },
        allowOnboardingFallback: true,
      }),
      [RESEND_VERIFIED_FROM, RESEND_ONBOARDING_FROM],
    );
  });
});
