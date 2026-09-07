import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CURRENT_TERMS_VERSION,
  TERMS_PUBLIC_URL,
  TERMS_REQUIRED_CODE,
  clientIp,
  hasAcceptedCurrentTerms,
  isAcceptableTermsVersion,
  isTermsExemptPath,
  termsStatus,
} from './terms.js';
import { requireAcceptedTermsVersion } from './termsStore.js';

describe('terms versioning', () => {
  it('treats the September 7 2026 Terms of Use as the live version', () => {
    assert.equal(CURRENT_TERMS_VERSION, '2026-09-07');
    assert.equal(TERMS_PUBLIC_URL, 'https://atmosphereteam.com/terms');
  });

  it('requires acknowledgment when nothing is recorded', () => {
    const status = termsStatus(null);
    assert.equal(status.required, true);
    assert.equal(status.acceptedVersion, null);
    assert.equal(status.currentVersion, CURRENT_TERMS_VERSION);
    assert.equal(status.url, TERMS_PUBLIC_URL);
  });

  it('requires acknowledgment again when the recorded version is older', () => {
    const status = termsStatus({
      termsVersion: '2025-01-01',
      acceptedAt: '2025-06-01T00:00:00.000Z',
    });
    assert.equal(status.required, true);
    assert.equal(status.acceptedVersion, '2025-01-01');
    assert.equal(hasAcceptedCurrentTerms('2025-01-01'), false);
  });

  it('clears the gate when the recorded version matches the live revision', () => {
    const status = termsStatus({
      termsVersion: CURRENT_TERMS_VERSION,
      acceptedAt: '2026-09-07T12:00:00.000Z',
    });
    assert.equal(status.required, false);
    assert.equal(hasAcceptedCurrentTerms(CURRENT_TERMS_VERSION), true);
  });

  it('rejects a missing or stale version on signup/register', () => {
    assert.equal(isAcceptableTermsVersion(undefined), false);
    assert.equal(isAcceptableTermsVersion(''), false);
    assert.equal(isAcceptableTermsVersion('2025-01-01'), false);
    assert.equal(isAcceptableTermsVersion(` ${CURRENT_TERMS_VERSION} `), true);
    assert.equal(isAcceptableTermsVersion(CURRENT_TERMS_VERSION), true);
  });

  it('throws terms_required when signup omits the live version', () => {
    assert.throws(
      () => requireAcceptedTermsVersion(undefined),
      (err: { status?: number; code?: string }) =>
        err.status === 400 && err.code === 'terms_required',
    );
    assert.throws(
      () => requireAcceptedTermsVersion('2025-01-01'),
      (err: { status?: number; code?: string }) =>
        err.status === 400 && err.code === 'terms_required',
    );
    assert.equal(requireAcceptedTermsVersion(CURRENT_TERMS_VERSION), CURRENT_TERMS_VERSION);
  });
});

describe('terms path exemptions', () => {
  it('lets session restore, acceptance, and sign-out through', () => {
    for (const path of [
      '/api/auth/me',
      '/api/auth/terms',
      '/api/auth/terms/accept',
      '/api/auth/logout',
      '/api/auth/refresh',
      '/api/auth/login',
      '/api/auth/signup',
      '/api/org/me',
      '/api/profile',
    ]) {
      assert.equal(isTermsExemptPath(path), true, path);
    }
  });

  it('blocks product APIs until the current version is accepted', () => {
    for (const path of [
      '/api/org',
      '/api/jobs',
      '/api/field-app/today',
      '/api/field-app/me',
      '/api/billing/onboarding',
    ]) {
      assert.equal(isTermsExemptPath(path), false, path);
    }
  });

  it('leaves staff legal and health probes unblocked', () => {
    assert.equal(isTermsExemptPath('/api/legal/holds'), true);
    assert.equal(isTermsExemptPath('/api/analytics/overview'), true);
    assert.equal(isTermsExemptPath('/api/health'), true);
    assert.equal(isTermsExemptPath('/ready'), true);
  });
});

describe('client metadata', () => {
  it('prefers the first forwarded IP', () => {
    assert.equal(
      clientIp({ headers: { 'x-forwarded-for': ' 203.0.113.9, 10.0.0.1 ' }, ip: '127.0.0.1' }),
      '203.0.113.9',
    );
    assert.equal(clientIp({ ip: '198.51.100.4' }), '198.51.100.4');
  });

  it('exports the terms_required code the clients branch on', () => {
    assert.equal(TERMS_REQUIRED_CODE, 'terms_required');
  });
});
