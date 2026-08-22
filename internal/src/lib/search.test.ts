import { describe, expect, it } from 'vitest';
import { filterAccounts, sortAccounts } from './search';
import type { AccountRow } from './types';

function account(partial: Partial<AccountRow> & Pick<AccountRow, 'orgId' | 'orgName'>): AccountRow {
  return {
    createdAt: '2026-01-01T00:00:00.000Z',
    planCode: 'pro',
    planName: 'Pro',
    billingInterval: 'monthly',
    status: 'active',
    seats: 1,
    members: 1,
    mrrCents: 0,
    arrCents: 0,
    revenueInRangeCents: 0,
    creditSpendCents: 0,
    activeHours: 0,
    topFeature: null,
    lastActiveAt: null,
    ...partial,
  };
}

describe('filterAccounts', () => {
  const rows = [
    account({ orgId: 'a', orgName: 'Harbor Mitigation', planCode: 'team', planName: 'Team', topFeature: 'Verifier' }),
    account({ orgId: 'b', orgName: 'Cedar Ridge', planName: 'Pro', status: 'trialing' }),
  ];

  it('returns all rows for an empty query', () => {
    expect(filterAccounts(rows, '  ')).toHaveLength(2);
  });

  it('matches name, plan, and top feature', () => {
    expect(filterAccounts(rows, 'harbor').map((r) => r.orgId)).toEqual(['a']);
    expect(filterAccounts(rows, 'pro').map((r) => r.orgId)).toEqual(['b']);
    expect(filterAccounts(rows, 'verifier').map((r) => r.orgId)).toEqual(['a']);
  });
});

describe('sortAccounts', () => {
  it('sorts by MRR descending', () => {
    const rows = [
      account({ orgId: 'a', orgName: 'A', mrrCents: 100 }),
      account({ orgId: 'b', orgName: 'B', mrrCents: 500 }),
    ];
    expect(sortAccounts(rows, 'mrr').map((r) => r.orgId)).toEqual(['b', 'a']);
  });
});
