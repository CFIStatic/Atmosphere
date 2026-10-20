import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isBlockedSupportRequest,
  isSessionLive,
  openToken,
  sealToken,
  sha256Hex,
  newOpaqueToken,
} from '../src/support/sessions.js';
import { assembleCustomers, classifyStatus } from '../src/analytics/customers.js';

test('sealed handoff token round-trips and rejects the wrong key', () => {
  const sealed = sealToken('access-token-abc', 'secret-one');
  assert.notEqual(sealed, 'access-token-abc');
  assert.equal(openToken(sealed, 'secret-one'), 'access-token-abc');
  assert.throws(() => openToken(sealed, 'secret-two'));
});

test('opaque tokens are unique and hashed deterministically', () => {
  const a = newOpaqueToken();
  assert.notEqual(a, newOpaqueToken());
  assert.equal(sha256Hex(a), sha256Hex(a));
  assert.equal(sha256Hex(a).length, 64);
});

test('sessions are live only before expiry and while not ended', () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const past = new Date(Date.now() - 1).toISOString();
  assert.equal(isSessionLive({ expires_at: future, ended_at: null } as never), true);
  assert.equal(isSessionLive({ expires_at: past, ended_at: null } as never), false);
  assert.equal(isSessionLive({ expires_at: future, ended_at: past } as never), false);
});

test('billing and account writes are blocked in support view; reads are not', () => {
  for (const [m, p] of [
    ['POST', '/api/billing/checkout'],
    ['POST', '/api/stripe/portal'],
    ['PUT', '/api/org/seats'],
    ['POST', '/api/org/credits/purchase'],
    ['DELETE', '/api/auth/account'],
    ['POST', '/api/auth/password'],
  ] as const) {
    assert.equal(isBlockedSupportRequest(m, p), true, `${m} ${p}`);
  }
  assert.equal(isBlockedSupportRequest('GET', '/api/billing/summary'), false);
  assert.equal(isBlockedSupportRequest('POST', '/api/support/exit'), false);
  assert.equal(isBlockedSupportRequest('POST', '/api/verification/jobs'), false);
});

test('customer status classification', () => {
  assert.equal(classifyStatus({ status: 'active', stripe_subscription_id: 'sub', stripe_livemode: true, stripe_mrr_cents: 9900 }, false), 'paying');
  assert.equal(classifyStatus({ status: 'trialing' }, false), 'trial');
  assert.equal(classifyStatus({ status: 'active' }, false), 'comped');
  assert.equal(classifyStatus(null, true), 'comped');
  assert.equal(classifyStatus({ status: 'past_due' }, false), 'unpaid');
  assert.equal(classifyStatus(null, false), 'none');
});

test('customers assemble per org with people, counts and test flags', () => {
  const out = assembleCustomers({
    orgs: [
      { id: 'o1', name: 'Ridge Roofing', created_by: 'u1', created_at: '2026-01-01T00:00:00Z' },
      { id: 'o2', name: 'Empty Co', created_by: null, created_at: '2026-02-01T00:00:00Z' },
    ],
    members: [
      { org_id: 'o1', user_id: 'u2', role: 'member', seat_type: 'field' },
      { org_id: 'o1', user_id: 'u1', role: 'owner', seat_type: 'platform' },
    ],
    profiles: [
      { id: 'u1', email: 'owner@example.com', full_name: 'Olive Owner' },
      { id: 'u2', email: 'crew@example.com', full_name: 'Carl Crew' },
    ],
    billing: [{ org_id: 'o1', status: 'trialing', plan_code: 'pro', platform_seats: 2 }],
    jobs: [
      { org_id: 'o1', updated_at: '2026-10-01T00:00:00Z' },
      { org_id: 'o1', updated_at: '2026-10-05T00:00:00Z' },
    ],
    lastSignIn: new Map([['u2', '2026-10-10T00:00:00Z']]),
    fcSeatsUsed: new Map([['o1', 1]]),
  });
  assert.equal(out.length, 2, 'nothing is dropped');
  const o1 = out[0]!;
  assert.equal(o1.people[0]!.email, 'owner@example.com', 'owner first');
  assert.equal(o1.ownerEmail, 'owner@example.com');
  assert.equal(o1.memberCount, 2);
  assert.equal(o1.jobsCount, 2);
  assert.equal(o1.status, 'trial');
  assert.equal(o1.lastActivityAt, '2026-10-10T00:00:00Z');
  assert.ok(o1.flags.includes('test'));
  assert.equal(o1.fcSeatsUsed, 1);
  assert.equal(out[1]!.memberCount, 0);
  assert.equal(out[1]!.fcSeatsUsed, null, 'not counted reads as unknown, not zero');
});
