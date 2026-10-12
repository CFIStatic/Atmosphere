import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accountLabel,
  authPhoneToE164,
  createOtpThrottle,
  formatPhoneForDisplay,
  jobInviteSms,
  normalizePhoneE164,
  orgInviteSms,
  phoneAuthEnabled,
} from '../src/auth/phoneAuth.js';

test('normalizePhoneE164: US default and E.164', () => {
  assert.equal(normalizePhoneE164('(312) 555-0100'), '+13125550100');
  assert.equal(normalizePhoneE164('312.555.0100'), '+13125550100');
  assert.equal(normalizePhoneE164('1 312 555 0100'), '+13125550100');
  assert.equal(normalizePhoneE164('+1 312 555 0100'), '+13125550100');
  assert.equal(normalizePhoneE164('+44 7700 900123'), '+447700900123');
});

test('normalizePhoneE164: rejects junk', () => {
  for (const bad of ['', '555-0100', '012 555 0100', '312 155 0100', 'call me', '+0123456789', '+1 312 555']) {
    assert.equal(normalizePhoneE164(bad), null, bad);
  }
});

test('display helpers', () => {
  assert.equal(authPhoneToE164('13125550100'), '+13125550100');
  assert.equal(formatPhoneForDisplay('13125550100'), '(312) 555-0100');
  assert.equal(formatPhoneForDisplay('+447700900123'), '+447700900123');
  assert.equal(accountLabel({ email: null, phone: '13125550100' }), '(312) 555-0100');
  assert.equal(accountLabel({ email: 'a@b.co', phone: '13125550100' }), 'a@b.co');
  assert.equal(accountLabel({}), 'Account');
});

test('feature flag is off unless explicitly true', () => {
  assert.equal(phoneAuthEnabled({}), false);
  assert.equal(phoneAuthEnabled({ PHONE_AUTH_ENABLED: '1' }), false);
  assert.equal(phoneAuthEnabled({ PHONE_AUTH_ENABLED: 'true' }), true);
});

test('OTP throttle: 30s gap and 5 per hour', () => {
  const t = createOtpThrottle();
  const p = '+13125550100';
  let now = 0;
  assert.deepEqual(t.check(p, now), { ok: true });
  t.record(p, now);
  const early = t.check(p, now + 10_000);
  assert.equal(early.ok, false);
  if (!early.ok) assert.equal(early.retryAfterSeconds, 20);
  for (let i = 1; i < 5; i++) {
    now += 31_000;
    assert.equal(t.check(p, now).ok, true);
    t.record(p, now);
  }
  now += 31_000;
  assert.equal(t.check(p, now).ok, false);
  assert.equal(t.check(p, 60 * 60 * 1000 + 1).ok, true);
  assert.equal(t.check('+13125550199', now).ok, true);
});

test('invite texts carry the link and the code hint', () => {
  const org = orgInviteSms({ orgName: 'Acme Restoration', inviterName: 'Jack', link: 'https://x.co/s' });
  assert.match(org, /Jack invited you to join Acme Restoration/);
  assert.match(org, /https:\/\/x\.co\/s/);
  assert.match(org, /6-digit code/);
  assert.match(jobInviteSms({ orgName: 'Acme', jobTitle: '12 Oak St', link: 'L' }), /shared "12 Oak St"/);
});

test('crew invite claim: phone-only invite matches the signed-in number', async () => {
  const { assertMayClaimCrewInvite, crewInviteSummary } = await import('../src/routes/crewInvite.js');
  const party = { email: null, phone: '+13125550100' };
  assert.doesNotThrow(() => assertMayClaimCrewInvite(party, null, '13125550100'));
  assert.throws(() => assertMayClaimCrewInvite(party, null, '13125550199'), /\(312\) 555-0100/);
  assert.throws(() => assertMayClaimCrewInvite(party, 'a@b.co', null), /Sign in with that number/);
  assert.deepEqual(crewInviteSummary(party, 'Acme', 'Oak'), {
    recipientEmail: null,
    recipientPhone: '+13125550100',
    orgName: 'Acme',
    jobTitle: 'Oak',
  });
  // Email invites behave as before.
  assert.doesNotThrow(() => assertMayClaimCrewInvite({ email: 'sub@x.co', phone: '+13125550100' }, 'SUB@x.co', null));
});

test('partiesInvitedToPhone: phone-only live rows for that number', async () => {
  const { partiesInvitedToPhone } = await import('../src/shared/inviteeJobAccess.js');
  const rows = [
    { id: '1', phone: '+13125550100', email: null, revoked_at: null },
    { id: '2', phone: '(312) 555-0100', email: null, revoked_at: null },
    { id: '3', phone: '+13125550100', email: 'x@y.co', revoked_at: null },
    { id: '4', phone: '+13125550100', email: null, revoked_at: '2026-01-01' },
  ];
  assert.deepEqual(partiesInvitedToPhone(rows, '13125550100').map((r) => r.id), ['1', '2']);
});
