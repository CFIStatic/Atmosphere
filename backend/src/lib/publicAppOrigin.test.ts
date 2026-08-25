import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  LIVE_OFFICE_ORIGIN,
  isUnusablePasswordResetUrl,
  passwordResetRedirectUrl,
  fieldCaptureInviteUrl,
  publicAppOrigin,
  publicFieldCaptureOrigin,
  recoveryPageUrl,
} from './publicAppOrigin.js';

describe('publicAppOrigin', () => {
  it('prefers the live Railway office over the unmapped custom domain', () => {
    assert.equal(
      publicAppOrigin([
        'https://app.atmosphereteam.com',
        'https://atmosphere-web-production.up.railway.app',
      ]),
      LIVE_OFFICE_ORIGIN,
    );
  });

  it('uses the Railway office when FRONTEND_ORIGIN is only the future custom domain', () => {
    assert.equal(publicAppOrigin(['https://app.atmosphereteam.com']), LIVE_OFFICE_ORIGIN);
  });

  it('keeps a mapped https origin that is not the future custom domain', () => {
    assert.equal(
      publicAppOrigin(['https://office.example.com']),
      'https://office.example.com',
    );
  });
});

describe('publicFieldCaptureOrigin', () => {
  it('prefers an explicit Field Capture origin', () => {
    assert.equal(
      publicFieldCaptureOrigin(
        ['https://atmosphere-web-production.up.railway.app'],
        'https://atmosphere-field-production.up.railway.app',
      ),
      'https://atmosphere-field-production.up.railway.app',
    );
  });

  it('picks a Field Capture Railway host off FRONTEND_ORIGIN', () => {
    assert.equal(
      publicFieldCaptureOrigin([
        'https://app.atmosphereteam.com',
        'https://atmosphere-field-production.up.railway.app',
      ]),
      'https://atmosphere-field-production.up.railway.app',
    );
  });

  it('falls back to the office origin so existing /fieldcapture/ links keep working', () => {
    assert.equal(
      publicFieldCaptureOrigin(['https://atmosphere-web-production.up.railway.app']),
      LIVE_OFFICE_ORIGIN,
    );
  });

  it('stamps the phone path and token onto that origin', () => {
    assert.equal(
      fieldCaptureInviteUrl(
        'abc 1',
        ['https://atmosphere-web-production.up.railway.app'],
        'https://atmosphere-field-production.up.railway.app',
      ),
      'https://atmosphere-field-production.up.railway.app/fieldcapture/index.html?token=abc%201',
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
