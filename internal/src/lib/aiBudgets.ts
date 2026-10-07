import { nanosToMoney } from './format';
import type { AiBudgetRow, StaffBillingClass, StaffBudget } from './types';

type BudgetRow = AiBudgetRow;

export const BILLING_LABEL: Record<StaffBillingClass, string> = {
  paying: 'Paying',
  past_due: 'Past due',
  comp: 'Comp',
  trialing: 'Trialing',
  canceled: 'Canceled',
  test_mode: 'Test mode',
  no_subscription: 'No subscription',
};

/** Reset column: a real date, or why there is none. */
export function resetLabel(staff: StaffBudget | undefined, fallback: string | null): string {
  if (staff?.periodNote === 'no_reset_comp_term') return 'No reset (comp term)';
  if (staff?.periodNote === 'ended_awaiting_renewal') return 'Period ended, awaiting renewal';
  const at = staff ? staff.displayResetAt : fallback;
  return at ? at.slice(0, 10) : '—';
}

/** Allowance column: "comp", "$0" or the dollar figure (10% of what the org pays). */
export function allowanceLabel(row: BudgetRow): string {
  if (row.staff) return row.staff.allowanceLabel;
  return nanosToMoney(row.allowanceNanos);
}

