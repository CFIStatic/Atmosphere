import { describe, expect, it } from 'vitest';
import { filterCounts, filterCustomers, humanize, initials, relativeDay, seatLabel, sortCustomers, type CustomerOrg } from './customers';

function org(over: Partial<CustomerOrg>): CustomerOrg {
  return {
    orgId: 'o', name: 'Org', ownerEmail: null, ownerName: null, planCode: null, billingStatus: null, status: 'none',
    stripeCustomerId: null, stripeLive: null, mrrCents: 0, includedFcSeats: 0, extraFcSeats: 0, fcSeatsUsed: null, platformSeats: 0,
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

describe('customer display helpers', () => {
  it('humanizes plan, role and seat codes', () => {
    expect(humanize('work_verification', true)).toBe('Work Verification');
    expect(humanize('global_admin')).toBe('Global admin');
    expect(humanize(null)).toBe('—');
    expect(seatLabel('field_capture')).toBe('Field Capture');
    expect(seatLabel(null)).toBeNull();
  });
  it('makes two-letter monograms', () => {
    expect(initials('Ridge Roofing')).toBe('RR');
    expect(initials('acme')).toBe('AC');
    expect(initials('(unnamed workspace)')).toBe('UW');
    expect(initials('')).toBe('?');
  });
  it('says how long ago in days, weeks and months', () => {
    const now = new Date('2026-10-20T12:00:00Z');
    expect(relativeDay('2026-10-20T08:00:00Z', now)).toBe('Today');
    expect(relativeDay('2026-10-19T08:00:00Z', now)).toBe('Yesterday');
    expect(relativeDay('2026-10-11T12:00:00Z', now)).toBe('9 days ago');
    expect(relativeDay('2026-09-20T12:00:00Z', now)).toBe('4 weeks ago');
    expect(relativeDay('2026-06-20T12:00:00Z', now)).toBe('4 months ago');
    expect(relativeDay(null, now)).toBeNull();
  });
});
