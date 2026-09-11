import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  LIVE_CUSTOM_APP_ORIGIN,
  LIVE_OFFICE_ORIGIN,
  isUnusablePasswordResetUrl,
  passwordResetRedirectUrl,
  publicAppOrigin,
  recoveryPageUrl,
} from './publicAppOrigin.js';

describe('publicAppOrigin', () => {
  it('prefers platform.atmosphereteam.com over the Railway office', () => {
    assert.equal(
      publicAppOrigin([
        LIVE_CUSTOM_APP_ORIGIN,
        'https://atmosphere-web-production.up.railway.app',
      ]),
      LIVE_CUSTOM_APP_ORIGIN,
    );
  });

  it('skips production Railway and Field Capture — stamps platform instead', () => {
    assert.equal(
      publicAppOrigin([
        'https://app.atmosphereteam.com',
        'https://atmosphere-web-production.up.railway.app',
      ]),
      LIVE_CUSTOM_APP_ORIGIN,
    );
  });

  it('still stamps a non-production Railway office (staging/preview)', () => {
    assert.equal(
      publicAppOrigin([
        'https://app.atmosphereteam.com',
        'https://atmosphere-web-staging.up.railway.app',
      ]),
      'https://atmosphere-web-staging.up.railway.app',
    );
  });

  it('falls back to platform.atmosphereteam.com when FRONTEND_ORIGIN is only Field Capture', () => {
    assert.equal(publicAppOrigin(['https://app.atmosphereteam.com']), LIVE_CUSTOM_APP_ORIGIN);
    assert.equal(LIVE_OFFICE_ORIGIN, LIVE_CUSTOM_APP_ORIGIN);
  });

  it('keeps a mapped https origin that is not the future custom domain', () => {
    assert.equal(
      publicAppOrigin(['https://office.example.com']),
      'https://office.example.com',
    );
  });
});

describe('passwordResetRedirectUrl', () => {
  const officeAndCustom = [
    'https://app.atmosphereteam.com',
    'https://atmosphere-web-production.up.railway.app',
  ];

  it('stamps the live office /reset-password, not FRONTEND_ORIGIN[0]', () => {
    assert.equal(
      passwordResetRedirectUrl(officeAndCustom, '', true),
      `${LIVE_OFFICE_ORIGIN}/reset-password`,
    );
  });

  it('rejects localhost:3000 even in development', () => {
    assert.equal(isUnusablePasswordResetUrl('http://localhost:3000/reset-password', false), true);
    assert.equal(
      passwordResetRedirectUrl(
        ['http://localhost:3000'],
        'http://localhost:3000/reset-password',
        false,
      ),
      `${LIVE_OFFICE_ORIGIN}/reset-password`,
    );
  });

  it('rejects loopback in production', () => {
    assert.equal(
      isUnusablePasswordResetUrl('http://localhost:5174/reset-password', true),
      true,
    );
  });

  it('does not stamp localhost FRONTEND_ORIGIN into recovery emails', () => {
    assert.equal(
      passwordResetRedirectUrl(
        ['http://localhost:5174', 'http://localhost:5173'],
        '',
        false,
      ),
      `${LIVE_OFFICE_ORIGIN}/reset-password`,
    );
  });

  it('keeps an explicit local Vite URL in development', () => {
    assert.equal(
      passwordResetRedirectUrl(
        ['http://localhost:5174'],
        'http://localhost:5174/reset-password',
        false,
      ),
      'http://localhost:5174/reset-password',
    );
  });

  it('puts token_hash on the reset page, never a session JWT', () => {
    const url = recoveryPageUrl(`${LIVE_OFFICE_ORIGIN}/reset-password`, 'hashed-token');
    assert.equal(
      url,
      `${LIVE_OFFICE_ORIGIN}/reset-password?token_hash=hashed-token&type=recovery`,
    );
    assert.ok(!url.includes('access_token'));
  });
});
