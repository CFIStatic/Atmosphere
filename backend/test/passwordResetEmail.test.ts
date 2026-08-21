import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { passwordResetEmail } from '../src/auth/passwordResetEmail.js';
import { LIVE_OFFICE_ORIGIN } from '../src/lib/publicAppOrigin.js';

const url = `${LIVE_OFFICE_ORIGIN}/reset-password?token_hash=abc&type=recovery`;

describe('passwordResetEmail', () => {
  it('sends people to the live office reset page, not localhost', () => {
    const { text, html, subject } = passwordResetEmail({ url });
    assert.equal(subject, 'Reset your Atmosphere password');
    assert.ok(text.includes(`\n  ${url}\n`));
    assert.ok(html.includes(LIVE_OFFICE_ORIGIN));
    assert.ok(html.includes('token_hash=abc'));
    assert.ok(html.includes('href="https://atmosphere-web-production.up.railway.app/reset-password?token_hash=abc&amp;type=recovery"'));
    assert.ok(!text.includes('localhost'));
    assert.ok(!html.includes('localhost'));
    assert.ok(!text.includes('access_token'));
  });

  it('says the link expires and can be ignored', () => {
    const { text, html } = passwordResetEmail({ url });
    assert.ok(text.includes('expires in one hour'));
    assert.ok(text.includes('ignore it'));
    assert.ok(html.includes('Reset password'));
  });
});
