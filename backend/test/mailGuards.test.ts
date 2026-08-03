import test from 'node:test';
import assert from 'node:assert/strict';
import {
  finaliseBody,
  screenRecipients,
  subjectProblems,
  validatePolicy,
} from '../src/campaigns/mail/guards.js';
import { buildRfc822 } from '../src/campaigns/mail/ports.js';

/**
 * This gate is the last thing between a weather trigger firing at 3am and
 * real email reaching real people from a customer's own mailbox. Every test
 * here is a specific way that goes wrong.
 */

const policy = {
  postalAddress: 'Atmosphere, 100 Congress Ave, Austin TX 78701',
  unsubscribeUrl: 'https://atmosphere.build/u',
  maxRecipients: 100,
  dailyCeiling: 450,
};

const base = {
  suppressedEmails: new Set<string>(),
  suppressedDomains: new Set<string>(),
  erasedEmails: new Set<string>(),
  unsubscribed: new Set<string>(),
  alreadySent: new Set<string>(),
  hardBounced: new Set<string>(),
  policy,
  sentToday: 0,
};

const to = (email: string) => ({ email });

test('an ordinary business contact gets through', () => {
  const { send } = screenRecipients({ ...base, recipients: [to('tomas@northgatemed.com')] });
  assert.equal(send.length, 1);
});

test('an erased person is never mailed, whatever else says otherwise', () => {
  // Erasure is the strongest claim anyone can make on their own data, and it
  // is checked first so a bug in a later rule cannot let it through.
  const { send, blocked } = screenRecipients({
    ...base,
    recipients: [to('tomas@northgatemed.com')],
    erasedEmails: new Set(['tomas@northgatemed.com']),
  });
  assert.equal(send.length, 0);
  assert.equal(blocked[0].reason, 'erased');
});

test('an unsubscribe is honoured immediately, not within ten days', () => {
  const { send, blocked } = screenRecipients({
    ...base,
    recipients: [to('tomas@northgatemed.com')],
    unsubscribed: new Set(['tomas@northgatemed.com']),
  });
  assert.equal(send.length, 0);
  assert.equal(blocked[0].reason, 'unsubscribed');
});

test('suppression works by address and by whole domain', () => {
  const byAddress = screenRecipients({
    ...base,
    recipients: [to('tomas@northgatemed.com')],
    suppressedEmails: new Set(['tomas@northgatemed.com']),
  });
  assert.equal(byAddress.send.length, 0);

  const byDomain = screenRecipients({
    ...base,
    recipients: [to('anyone@northgatemed.com')],
    suppressedDomains: new Set(['northgatemed.com']),
  });
  assert.equal(byDomain.send.length, 0);
});

test('somebody who hard bounced before is not tried again', () => {
  // Repeatedly mailing a dead address is precisely what gets a sending domain
  // blocklisted.
  const { send, blocked } = screenRecipients({
    ...base,
    recipients: [to('gone@northgatemed.com')],
    hardBounced: new Set(['gone@northgatemed.com']),
  });
  assert.equal(send.length, 0);
  assert.equal(blocked[0].reason, 'bounced_before');
});

test('re-running a send does not mail the same person twice', () => {
  const { send, blocked } = screenRecipients({
    ...base,
    recipients: [to('tomas@northgatemed.com')],
    alreadySent: new Set(['tomas@northgatemed.com']),
  });
  assert.equal(send.length, 0);
  assert.equal(blocked[0].reason, 'already_sent');
});

test('one person appearing twice in an audience gets one email', () => {
  // Audience rules can produce the same human as a contact and as a place, or
  // via two categories. They are still one person.
  const { send } = screenRecipients({
    ...base,
    recipients: [to('tomas@northgatemed.com'), to('TOMAS@northgatemed.com'), to('tomas@northgatemed.com')],
  });
  assert.equal(send.length, 1);
});

test('role, personal and disposable addresses are refused', () => {
  const { send, blocked } = screenRecipients({
    ...base,
    recipients: [to('info@northgatemed.com'), to('someone@gmail.com'), to('x@mailinator.com')],
  });
  assert.equal(send.length, 0);
  assert.deepEqual(
    blocked.map((b) => b.reason).sort(),
    ['disposable', 'personal_address', 'role_address'],
  );
});

test('the campaign cap holds, and the overflow is reported not dropped', () => {
  const many = Array.from({ length: 10 }, (_, i) => to(`p${i}@acme.com`));
  const { send, blocked } = screenRecipients({
    ...base,
    recipients: many,
    policy: { ...policy, maxRecipients: 3 },
  });
  assert.equal(send.length, 3);
  assert.equal(blocked.filter((b) => b.reason === 'over_campaign_cap').length, 7);
});

test('the daily mailbox ceiling counts what was already sent today', () => {
  const many = Array.from({ length: 10 }, (_, i) => to(`p${i}@acme.com`));
  const { send, blocked } = screenRecipients({
    ...base,
    recipients: many,
    sentToday: 447,
    policy: { ...policy, dailyCeiling: 450 },
  });
  assert.equal(send.length, 3);
  assert.ok(blocked.every((b) => b.reason === 'over_daily_cap'));
});

test('a send cannot start without the things the law requires', () => {
  assert.deepEqual(validatePolicy({ ...policy }), []);
  assert.equal(validatePolicy({ ...policy, postalAddress: '' }).length, 1);
  assert.equal(validatePolicy({ ...policy, unsubscribeUrl: '' }).length, 1);
});

test('every message carries an address and a working unsubscribe', () => {
  const body = finaliseBody('Hi Tomas, hope you are well.', policy, 'tok123');
  assert.ok(body.includes(policy.postalAddress));
  assert.ok(body.includes('Unsubscribe'));
  assert.ok(body.includes('t=tok123'));
});

test('deceptive subjects are caught', () => {
  // Faking a reply to a conversation that never happened is the specific thing
  // CAN-SPAM prohibits, and the fastest way to be reported.
  assert.ok(subjectProblems('Re: our conversation').length > 0);
  assert.ok(subjectProblems('ACT NOW FREE ROOF INSPECTION').length > 0);
  assert.ok(subjectProblems('').length > 0);
  assert.deepEqual(subjectProblems('Checking in ahead of the weather'), []);
});

/* ---- header injection ---------------------------------------------------- */

test('a newline in a name or subject cannot forge headers', () => {
  // Without stripping, a crafted name appends real headers — Bcc being the
  // interesting one — and one campaign quietly copies an attacker on everything.
  const raw = buildRfc822(
    {
      to: 'tomas@northgatemed.com',
      toName: 'Tomas\r\nBcc: attacker@evil.com',
      subject: 'Hello\r\nX-Injected: yes',
      text: 'Body text',
    },
    { address: 'dana@atmosphere.build', displayName: 'Dana', provider: 'Gmail' },
  );

  const headerBlock = raw.split('\r\n\r\n')[0];
  assert.ok(!/^Bcc:/im.test(headerBlock), 'Bcc must not be forgeable');
  assert.ok(!/^X-Injected:/im.test(headerBlock), 'arbitrary headers must not be forgeable');
  assert.ok(headerBlock.includes('To: '));
});

test('non-ASCII survives in headers and body', () => {
  const raw = buildRfc822(
    {
      to: 'jose@acme.com',
      toName: 'José Núñez',
      subject: 'Café — checking in',
      text: 'Hola José — ¿todo bien?',
    },
    { address: 'dana@atmosphere.build', displayName: null, provider: 'Gmail' },
  );
  // Encoded rather than passed through raw, which would arrive as mojibake.
  assert.ok(raw.includes('=?UTF-8?B?'));
  const body = raw.split('\r\n\r\n')[1];
  assert.ok(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8').includes('José'));
});

/* ---- one-click unsubscribe and send correlation -------------------------- */

test('List-Unsubscribe headers are emitted when an unsubscribe URL is given', () => {
  // These turn "reported as spam" into "removed", which is the difference
  // between a complaint that damages the customer's domain and one that
  // does not. Gmail and Yahoo both weight them for bulk senders.
  const raw = buildRfc822(
    {
      to: 'tomas@northgatemed.com',
      subject: 'Checking in',
      text: 'Body',
      unsubscribe: { url: 'https://api.atmosphere.build/api/unsubscribe?t=abc123' },
      sendId: 'send-42',
    },
    { address: 'dana@atmosphere.build', displayName: 'Dana', provider: 'Gmail' },
  );
  const headers = raw.split('\r\n\r\n')[0];
  assert.match(headers, /^List-Unsubscribe: <https:\/\/api\.atmosphere\.build\/api\/unsubscribe\?t=abc123>$/m);
  assert.match(headers, /^List-Unsubscribe-Post: List-Unsubscribe=One-Click$/m);
  // Graph returns no message id, so this header is the only way to correlate
  // a later bounce on the Microsoft path.
  assert.match(headers, /^X-Atmosphere-Send-Id: send-42$/m);
});

test('an unsubscribe URL cannot smuggle headers either', () => {
  const raw = buildRfc822(
    {
      to: 'tomas@northgatemed.com',
      subject: 'Checking in',
      text: 'Body',
      unsubscribe: { url: 'https://x.test/u\r\nBcc: attacker@evil.com' },
    },
    { address: 'dana@atmosphere.build', displayName: null, provider: 'Gmail' },
  );
  assert.ok(!/^Bcc:/im.test(raw.split('\r\n\r\n')[0]));
});

test('the headers are absent when nothing asks for them', () => {
  const raw = buildRfc822(
    { to: 'a@b.com', subject: 'x', text: 'y' },
    { address: 'c@d.com', displayName: null, provider: 'Gmail' },
  );
  const headers = raw.split('\r\n\r\n')[0];
  assert.ok(!headers.includes('List-Unsubscribe'));
  assert.ok(!headers.includes('X-Atmosphere-Send-Id'));
});
