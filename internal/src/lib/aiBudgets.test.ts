import { describe, expect, it } from 'vitest';
import { allowanceLabel, resetLabel } from './aiBudgets';
import type { AiBudgetRow, StaffBudget } from './types';

const staff = (over: Partial<StaffBudget>): StaffBudget => ({
  billingClass: 'paying',
  paidMonthlyCents: 84_900,
  paidSource: 'catalog',
  allowanceMonthlyNanos: 84_900_000_000,
  allowanceLabel: '$84.90',
  periodNote: null,
  displayResetAt: '2026-11-01T00:00:00Z',
  usedOfAllowancePct: 12.5,
  aiCostNanos: 10_612_500_000,
  costWindow: { from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z' },
  ...over,
});
const row = (s: StaffBudget | undefined): AiBudgetRow => ({
  orgId: 'org',
  orgName: 'Test Restoration Co (TEST DATA)',
  state: 'ok',
  paused: false,
  usedNanos: 0,
  allowanceNanos: 84_900_000_000,
  usedFraction: 0,
  creditBalanceNanos: 0,
  resetAt: '2126-10-01T00:00:00Z',
  staff: s,
});

describe('AI budgets display (TEST DATA)', () => {
  it('shows comp, $0 or the allowance from what the org pays', () => {
    expect(allowanceLabel(row(staff({})))).toBe('$84.90');
    expect(allowanceLabel(row(staff({ billingClass: 'comp', allowanceLabel: 'comp', allowanceMonthlyNanos: null })))).toBe('comp');
    expect(allowanceLabel(row(staff({ billingClass: 'trialing', allowanceLabel: '$0', allowanceMonthlyNanos: 0 })))).toBe('$0');
  });

  it('never shows a 2126 reset or a reset date in the past', () => {
    expect(resetLabel(staff({ periodNote: 'no_reset_comp_term', displayResetAt: null }), '2126-10-01T00:00:00Z')).toBe('No reset (comp term)');
    expect(resetLabel(staff({ periodNote: 'ended_awaiting_renewal', displayResetAt: null }), '2026-09-01T00:00:00Z')).toBe(
      'Period ended, awaiting renewal',
    );
    expect(resetLabel(staff({}), null)).toBe('2026-11-01');
  });
});
