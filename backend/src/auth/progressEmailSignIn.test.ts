import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertInvitedUser, normalizeEmail, progressSignInUrl } from './progressEmailSignIn.js';
import { progressSignInEmail } from './progressSignInEmail.js';

describe('progress email sign-in', () => {
  it('builds a link back to the same job file with a one-time hash', () => {
    const url = new URL(progressSignInUrl('https://platform.atmosphereteam.com', 'tok_abc123', 'hash1', 'invite'));
    assert.equal(url.pathname, '/progress/tok_abc123');
    assert.equal(url.searchParams.get('signin'), 'hash1');
    assert.equal(url.searchParams.get('kind'), 'invite');
  });

  it('only lets the invited email through', () => {
    assert.doesNotThrow(() => assertInvitedUser({ email: ' Home@Example.com ' }, 'home@example.com'));
    assert.throws(() => assertInvitedUser({ email: 'other@example.com' }, 'home@example.com'), /different email/);
    assert.throws(() => assertInvitedUser({ email: undefined }, 'home@example.com'));
    assert.throws(() => assertInvitedUser({ email: 'a@b.co' }, ''));
    assert.equal(normalizeEmail(42), '');
  });

  it('renders a branded email with the link and code, escaped', () => {
    const mail = progressSignInEmail({ url: 'https://x.test/progress/t?signin=h', code: '123456', orgName: 'Jettx <LLC>' });
    assert.match(mail.subject, /Jettx <LLC> job file/);
    assert.match(mail.html, /Open the job file/);
    assert.match(mail.html, /123456/);
    assert.match(mail.html, /Jettx &lt;LLC&gt;/);
    assert.match(mail.text, /No password needed/);
  });
});
