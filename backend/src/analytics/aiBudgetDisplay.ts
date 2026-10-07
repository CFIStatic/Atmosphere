/**
 * Staff AI budgets: what each org pays, its AI allowance, and its AI cost.
 * Display only (analytics audit 2026-10-07). Enforcement is unchanged and
 * still lives in metering/aiBudgetService.ts.
 *
 *   - allowance = allowanceFraction (10%) of what the org ACTUALLY pays per
 *     month: the stored Stripe amount, else the catalog price, and only for a
 *     real live-mode subscription in status active or past_due
 *   - comp orgs (comp_ subscription or status comped) show "comp", no allowance
 *   - orgs with no paid subscription (none, trialing, canceled, test mode) show $0
 *   - a billing period ending more than 400 days out (e.g. 2126 on comp terms)
 *     is shown as "no reset"; a period that already ended is shown as "ended,
 *     awaiting renewal" instead of a reset date in the past
 */
import { catalogMonthlyCents } from '../lib/subscriptionMrr.js';

export type StaffBillingClass =
  | 'paying'
  | 'past_due'
  | 'comp'
  | 'trialing'
  | 'canceled'
  | 'test_mode'
  | 'no_subscription';

export type PeriodNote = 'no_reset_comp_term' | 'ended_awaiting_renewal' | null;

export interface StaffBillingRow {
  status?: string | null;
  stripe_subscription_id?: string | null;
  stripe_mrr_cents?: number | string | null;
  stripe_interval?: string | null;
  stripe_livemode?: boolean | null;
  atmosphere_plan_code?: string | null;
  extra_fc_seats?: number | string | null;
  billing_interval?: string | null;
  period_start?: string | null;
  period_end?: string | null;
}

export interface StaffBudgetDisplay {
  billingClass: StaffBillingClass;
  /** What the org pays per month, in cents (0 unless paying). */
  paidMonthlyCents: number;
  /** 'stripe' = stored Stripe amount; 'catalog' = plan price fallback; null = not paying. */
  paidSource: 'stripe' | 'catalog' | null;
  /** Monthly AI allowance in nanos; null for comp (no allowance applies). */
  allowanceMonthlyNanos: number | null;
  /** "comp", "$0" or a dollar figure: what the Allowance column shows. */
  allowanceLabel: string;
  periodNote: PeriodNote;
  /** Reset date to show, or null when there is no sensible one. */
  displayResetAt: string | null;
  /** AI cost as a share of the monthly allowance (0-100+), null when not meaningful. */
  usedOfAllowancePct: number | null;
}

const NANOS_PER_CENT = 10_000_000;
const FAR_FUTURE_DAYS = 400;

export function classifyBilling(row: StaffBillingRow | null | undefined): StaffBillingClass {
  if (!row) return 'no_subscription';
  const sub = row.stripe_subscription_id ?? '';
  if (sub.startsWith('comp_') || row.status === 'comped') return 'comp';
  if (!sub.startsWith('sub_')) return 'no_subscription';
  if (row.stripe_livemode === false) return 'test_mode';
  if (row.status === 'active') return 'paying';
  if (row.status === 'past_due') return 'past_due';
  if (row.status === 'trialing') return 'trialing';
  return 'canceled';
}

export function paidMonthlyCents(row: StaffBillingRow | null | undefined): {
  cents: number;
  source: 'stripe' | 'catalog' | null;
} {
  const cls = classifyBilling(row);
  if (!row || (cls !== 'paying' && cls !== 'past_due')) return { cents: 0, source: null };
  if (row.stripe_mrr_cents !== null && row.stripe_mrr_cents !== undefined && row.stripe_mrr_cents !== '') {
    return { cents: Math.max(0, Math.round(Number(row.stripe_mrr_cents) || 0)), source: 'stripe' };
  }
  const interval =
    row.stripe_interval === 'year' || row.billing_interval === 'annual' || row.billing_interval === 'year'
      ? 'year'
      : 'month';
  return {
    cents: catalogMonthlyCents(row.atmosphere_plan_code ?? 'work_verification', interval, Number(row.extra_fc_seats ?? 0)),
    source: 'catalog',
  };
}

export function periodNote(periodEnd: string | null | undefined, now: Date): PeriodNote {
  if (!periodEnd) return null;
  const end = Date.parse(periodEnd);
  if (!Number.isFinite(end)) return null;
  if (end > now.getTime() + FAR_FUTURE_DAYS * 86_400_000) return 'no_reset_comp_term';
  if (end < now.getTime()) return 'ended_awaiting_renewal';
  return null;
}

function dollarsLabel(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function staffBudgetDisplay(
  row: StaffBillingRow | null | undefined,
  opts: { allowanceFraction: number; aiCostNanos: number; now?: Date },
): StaffBudgetDisplay {
  const now = opts.now ?? new Date();
  const billingClass = classifyBilling(row);
  const paid = paidMonthlyCents(row);
  const note = periodNote(row?.period_end ?? null, now);
  const allowanceMonthlyNanos =
    billingClass === 'comp' ? null : Math.round(paid.cents * opts.allowanceFraction * NANOS_PER_CENT);
  const allowanceLabel =
    billingClass === 'comp'
      ? 'comp'
      : allowanceMonthlyNanos && allowanceMonthlyNanos > 0
        ? dollarsLabel(allowanceMonthlyNanos / NANOS_PER_CENT)
        : '$0';
  const usedOfAllowancePct =
    allowanceMonthlyNanos && allowanceMonthlyNanos > 0
      ? Math.round((opts.aiCostNanos / allowanceMonthlyNanos) * 1000) / 10
      : null;
  return {
    billingClass,
    paidMonthlyCents: paid.cents,
    paidSource: paid.source,
    allowanceMonthlyNanos,
    allowanceLabel,
    periodNote: note,
    displayResetAt: note ? null : (row?.period_end ?? null),
    usedOfAllowancePct,
  };
}

/** Calendar month (UTC) used for AI cost, so every org is measured over the same window. */
export function currentUtcMonth(now: Date = new Date()): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}
