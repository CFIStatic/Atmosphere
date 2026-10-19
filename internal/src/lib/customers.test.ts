import { describe, expect, it } from 'vitest';
import { filterCounts, filterCustomers, sortCustomers, type CustomerOrg } from './customers';

function org(over: Partial<CustomerOrg>): CustomerOrg {
  return {
    orgId: 'o', name: 'Org', ownerEmail: null, ownerName: null, planCode: null, billingStatus: null, status: 'none',
    stripeCustomerId: null, stripeLive: null, mrrCents: 0, includedFcSeats: 0, extraFcSeats: 0, platformSeats: 0,
    memberCount: 0, jobsCount: 0, createdAt: null, lastActivityAt: null, flags: [], people: [], ...over,
  };
}

const rows = [
  org({ orgId: 'a', name: 'Ridge Roofing', status: 'paying', mrrCents: 50000, people: [{ userId: 'u', name: 'Dana Ruiz', email: 'dana@example.com', role: 'member', seatType: null, status: null, isOwner: false, joinedAt: null, lastSignInAt: null }] }),
  org({ orgId: 'b', name: 'Atlas Builders', status: 'trial', mrrCents: 0 }),
  org({ orgId: 'c', name: 'Staff Sandbox', status: 'comped', flags: ['staff'] }),
];

describe('customers', () => {
  it('searches org names and member emails', () => {
    expect(filterCustomers(rows, 'atlas', 'all').map((r) => r.orgId)).toEqual(['b']);
    expect(filterCustomers(rows, 'dana@example', 'all').map((r) => r.orgId)).toEqual(['a']);
  });
  it('filters by status and test/staff flags without dropping anything from All', () => {
    expect(filterCustomers(rows, '', 'all')).toHaveLength(3);
    expect(filterCustomers(rows, '', 'paying').map((r) => r.orgId)).toEqual(['a']);
    expect(filterCustomers(rows, '', 'test').map((r) => r.orgId)).toEqual(['c']);
    expect(filterCounts(rows)).toEqual({ all: 3, paying: 1, trial: 1, comped: 1, test: 1 });
  });
  it('sorts both directions', () => {
    expect(sortCustomers(rows, 'name', 'asc').map((r) => r.orgId)).toEqual(['b', 'a', 'c']);
    expect(sortCustomers(rows, 'mrr', 'desc')[0]!.orgId).toBe('a');
  });
});
