import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { passwordResetEmail } from '../src/auth/passwordResetEmail.js';
import { LIVE_OFFICE_ORIGIN } from '../src/lib/publicAppOrigin.js';

const url = `${LIVE_OFFICE_ORIGIN}/reset-password?token_hash=abc&type=recovery`;

describe('passwordResetEmail', () => {
  it('is an Atmosphere message, not Supabase Auth', () => {
    const { text, html, subject } = passwordResetEmail({ url });
    assert.equal(subject, 'Choose a new Atmosphere password');
    assert.ok(text.startsWith('Atmosphere\n'));
    assert.ok(html.includes('Sent by Atmosphere'));
    assert.ok(!/supabase/i.test(text));
    assert.ok(!/supabase/i.test(html));
    assert.ok(!/supabase/i.test(subject));
  });

  it('sends people to the live office reset page, not localhost', () => {
    const { text, html } = passwordResetEmail({ url });
    assert.ok(text.includes(`\n  ${url}\n`));
    assert.ok(html.includes(LIVE_OFFICE_ORIGIN));
    assert.ok(html.includes('token_hash=abc'));
    assert.ok(
      html.includes(
        'href="https://atmosphere-web-production.up.railway.app/reset-password?token_hash=abc&amp;type=recovery"',
      ),
    );
    assert.ok(!text.includes('localhost'));
    assert.ok(!html.includes('localhost'));
    assert.ok(!text.includes('access_token'));
  });

  it('uses the five-bar mark, a terracotta button, and the expiry receipt', () => {
    const { text, html } = passwordResetEmail({ url });
    assert.ok(html.includes('#A8A29E'));
    assert.ok(html.includes('#F2670C'));
    assert.ok(html.includes('#D2500A'));
    assert.ok(html.includes('Choose a new password'));
    assert.ok(html.includes('Expires in 1 hour · one use'));
    assert.ok(html.includes(`${LIVE_OFFICE_ORIGIN}/login`));
    assert.ok(text.includes('expires in one hour'));
    assert.ok(text.includes('ignore it'));
  });
});
