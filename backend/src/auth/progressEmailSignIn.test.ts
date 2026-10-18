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

  it('renders just the code, escaped, with no link', () => {
    const mail = progressSignInEmail({ url: 'https://x.test/progress/t?signin=h', code: '12345678', orgName: 'Jettx <LLC>' });
    assert.equal(mail.subject, 'Your Atmosphere sign-in code');
    assert.match(mail.html, /12345678/);
    assert.match(mail.text, /12345678/);
    assert.doesNotMatch(mail.html, /x\.test|<a /);
    assert.doesNotMatch(mail.text, /x\.test/);
    assert.match(mail.html, /Expires in 1 hour/);
  });

  it('falls back to the link when there is no code', () => {
    const mail = progressSignInEmail({ url: 'https://x.test/progress/t?signin=h&a=1', code: null, orgName: null });
    assert.equal(mail.subject, 'Your Atmosphere sign-in link');
    assert.match(mail.html, /href="https:\/\/x\.test\/progress\/t\?signin=h&amp;a=1"/);
    assert.match(mail.text, /x\.test/);
  });
});
