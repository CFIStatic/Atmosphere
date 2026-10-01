/**
 * AI allowance math.
 *
 * The included allowance is a share of what the org pays for the billing
 * period (plan + extra seats), prorated when the price changes mid-period.
 * It resets at the period boundary and does not roll over.
 *
 * Purchased credits and manual grants roll over until they are used. They are
 * prepaid AI spend, not a second monthly allotment, and they are drawn only
 * after the included allowance (and its rolling window) cannot cover the call.
 *
 * Customer copy lives in `customerAllowanceMessage`. It never states the
 * internal share of revenue.
 */

import { NANOS_PER_CENT } from '../lib/money.js';
import { canManageBilling } from '../lib/productRoles.js';
import type { AiBudgetConfig } from './aiBudgetConfig.js';

export interface BudgetPriceSpan {
  amountCents: number;
  from: Date;
  to: Date | null;
}

export interface RecurringItem {
  unitAmountCents: number | null;
  quantity: number;
  interval: 'month' | 'year' | 'week' | 'day' | null;
}

export type AllowanceState = 'ok' | 'warning' | 'credits' | 'limited';

export interface AllowanceEvaluation {
  unlimited: boolean;
  periodAllowanceNanos: number;
  monthlyAllowanceNanos: number;
  periodSpendNanos: number;
  includedUsedNanos: number;
  windowSpendNanos: number;
  rollingCapNanos: number | null;
  rollingLimited: boolean;
  includedRemainingNanos: number;
  creditBalanceNanos: number;
  usedFraction: number;
  state: AllowanceState;
  paused: boolean;
  warning: boolean;
}

/** Full recurring charge for the interval, including extra seats. */
export function subscriptionAmountCents(input: {
  planCents: number;
  extraSeats: number;
  extraSeatCents: number;
}): number {
  const seats = Math.max(0, Math.floor(input.extraSeats));
  const plan = Math.max(0, Math.round(input.planCents));
  const seat = Math.max(0, Math.round(input.extraSeatCents));
  return plan + seats * seat;
}

export function recurringChargeFromItems(items: RecurringItem[]): {
  amountCents: number;
  interval: 'month' | 'year';
} | null {
  const priced = items.filter((item) => item.unitAmountCents != null && item.unitAmountCents >= 0);
  if (!priced.length) return null;
  const amountCents = priced.reduce(
    (sum, item) => sum + Math.round(item.unitAmountCents ?? 0) * Math.max(1, Math.round(item.quantity || 1)),
    0,
  );
  const interval = priced.some((item) => item.interval === 'year') ? 'year' : 'month';
  return { amountCents, interval };
}

/**
 * Time-weighted charge for the period. Each span's amountCents is the full
 * recurring price (monthly or annual) that was in force while it overlapped
 * the period. A $399 plan for half a 30-day month and an $849 plan for the
 * other half bills 50/50 of those prices.
 */
export function proratedPeriodChargeCents(
  periodStart: Date,
  periodEnd: Date,
  spans: BudgetPriceSpan[],
): number {
  const periodStartMs = periodStart.getTime();
  const periodEndMs = periodEnd.getTime();
  const periodMs = periodEndMs - periodStartMs;
  if (!(periodMs > 0) || !spans.length) return 0;

  // Clip to the period, then bill each instant once. Where spans overlap, the
  // one that started later is the price that should have closed the earlier
  // span. Summing both would inflate the allowance after a raced webhook.
  const clipped = spans
    .map((span, index) => {
      const started = span.from.getTime();
      const from = Math.max(periodStartMs, started);
      const to = Math.min(periodEndMs, span.to ? span.to.getTime() : periodEndMs);
      return { amountCents: span.amountCents, from, to, started, index };
    })
    .filter((span) => span.to > span.from);
  if (!clipped.length) return 0;

  const bounds = new Set<number>([periodStartMs, periodEndMs]);
  for (const span of clipped) {
    bounds.add(span.from);
    bounds.add(span.to);
  }
  const points = [...bounds].filter((t) => t >= periodStartMs && t <= periodEndMs).sort((a, b) => a - b);

  let charge = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const start = points[i]!;
    const end = points[i + 1]!;
    if (end <= start) continue;
    const covering = clipped.filter((span) => span.from <= start && span.to >= end);
    if (!covering.length) continue;
    covering.sort((a, b) => a.started - b.started || a.index - b.index);
    const chosen = covering[covering.length - 1]!;
    charge += chosen.amountCents * ((end - start) / periodMs);
  }
  return Math.round(charge);
}

/** First observation covers the whole period. Later changes start at the change. */
export function spanEffectiveFrom(input: {
  hasExistingSpan: boolean;
  periodStart: Date | null;
  at: Date;
}): Date {
  if (!input.hasExistingSpan && input.periodStart && input.periodStart.getTime() < input.at.getTime()) {
    return input.periodStart;
  }
  return input.at;
}

export function allowanceNanos(chargeCents: number, fraction: number): number {
  if (!Number.isFinite(chargeCents) || chargeCents <= 0) return 0;
  if (!Number.isFinite(fraction) || fraction <= 0) return 0;
  return Math.round(chargeCents * NANOS_PER_CENT * fraction);
}

/** Monthly slice of a period allowance. Annual periods are twelve months. */
export function monthlyAllowanceNanos(
  periodAllowanceNanos: number,
  periodStart: Date,
  periodEnd: Date,
): number {
  if (periodAllowanceNanos <= 0) return 0;
  const days = (periodEnd.getTime() - periodStart.getTime()) / 86_400_000;
  if (days >= 300) return Math.round(periodAllowanceNanos / 12);
  return periodAllowanceNanos;
}

export function rollingCapNanos(
  monthlyAllowance: number,
  fraction: number,
  enabled: boolean,
): number | null {
  if (!enabled) return null;
  if (monthlyAllowance <= 0 || fraction <= 0) return 0;
  return Math.round(monthlyAllowance * fraction);
}

export function evaluateAllowance(input: {
  unlimited?: boolean;
  periodAllowanceNanos: number;
  monthlyAllowanceNanos: number;
  periodSpendNanos: number;
  windowSpendNanos: number;
  creditBalanceNanos: number;
  config: Pick<AiBudgetConfig, 'warnFraction' | 'rollingEnabled' | 'rollingFraction'>;
}): AllowanceEvaluation {
  const unlimited = Boolean(input.unlimited);
  const periodAllowanceNanos = Math.max(0, Math.round(input.periodAllowanceNanos));
  const monthlyAllowanceNanos = Math.max(0, Math.round(input.monthlyAllowanceNanos));
  const periodSpendNanos = Math.max(0, Math.round(input.periodSpendNanos));
  const windowSpendNanos = Math.max(0, Math.round(input.windowSpendNanos));
  const creditBalanceNanos = Math.max(0, Math.round(input.creditBalanceNanos));
  const cap = rollingCapNanos(
    monthlyAllowanceNanos,
    input.config.rollingFraction,
    input.config.rollingEnabled,
  );
  const includedUsedNanos = Math.min(periodSpendNanos, periodAllowanceNanos);
  const includedRemainingNanos = Math.max(0, periodAllowanceNanos - periodSpendNanos);
  const rollingLimited = cap != null && windowSpendNanos >= cap && cap >= 0;
  const windowOpen = cap == null || windowSpendNanos < cap;
  const includedUsable = includedRemainingNanos > 0 && windowOpen;
  const paused = !unlimited && !includedUsable && creditBalanceNanos <= 0;
  const usedFraction =
    periodAllowanceNanos <= 0 ? (periodSpendNanos > 0 ? 1 : 0) : periodSpendNanos / periodAllowanceNanos;
  const warnAt = input.config.warnFraction;
  const usingCredits = !unlimited && !includedUsable && creditBalanceNanos > 0;
  const warning = !paused && (usingCredits || (usedFraction >= warnAt && usedFraction < 1) || (rollingLimited && creditBalanceNanos > 0));
  let state: AllowanceState = 'ok';
  if (paused) state = 'limited';
  else if (usingCredits) state = 'credits';
  else if (!unlimited && usedFraction >= warnAt) state = 'warning';
  return {
    unlimited,
    periodAllowanceNanos,
    monthlyAllowanceNanos,
    periodSpendNanos,
    includedUsedNanos,
    windowSpendNanos,
    rollingCapNanos: cap,
    rollingLimited: !unlimited && rollingLimited,
    includedRemainingNanos,
    creditBalanceNanos,
    usedFraction,
    state,
    paused,
    warning: !unlimited && warning,
  };
}

/**
 * How one call is paid for. Included allowance first, unless the rolling
 * window is already full. Credits cover the rest. A call that cannot be
 * covered is blocked; callers still store uploads.
 */
export function allocateUsage(input: {
  costNanos: number;
  includedRemainingNanos: number;
  windowSpendNanos: number;
  rollingCapNanos: number | null;
  creditBalanceNanos: number;
}): { allowanceNanos: number; creditNanos: number; blocked: boolean } {
  const cost = Math.max(0, Math.round(input.costNanos));
  if (cost === 0) return { allowanceNanos: 0, creditNanos: 0, blocked: false };
  const cap = input.rollingCapNanos;
  const windowRoom =
    cap == null ? Number.POSITIVE_INFINITY : Math.max(0, cap - Math.max(0, input.windowSpendNanos));
  const allowanceNanos = Math.min(
    cost,
    Math.max(0, input.includedRemainingNanos),
    windowRoom,
  );
  const rest = cost - allowanceNanos;
  const creditNanos = Math.min(rest, Math.max(0, input.creditBalanceNanos));
  return {
    allowanceNanos,
    creditNanos,
    blocked: allowanceNanos + creditNanos < cost,
  };
}

/** Uploads always store. Analysis runs now or waits for allowance. */
export function videoUploadOutcome(paused: boolean): { stored: true; analysis: 'queued' | 'budget_hold' } {
  return { stored: true, analysis: paused ? 'budget_hold' : 'queued' };
}

export function documentUploadOutcome(paused: boolean): { stored: true; analysis: 'queued' | 'budget_hold' } {
  return { stored: true, analysis: paused ? 'budget_hold' : 'queued' };
}

export function creditNanosForPaymentCents(cents: number, ratio: number): number {
  if (!Number.isFinite(cents) || cents <= 0) return 0;
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  return Math.round(cents * NANOS_PER_CENT * ratio);
}

/** Credits originally granted for a charge whose metadata marks an AI credit pack. */
export function grantedNanosFromCreditMetadata(
  metadata: Record<string, string> | null | undefined,
  chargeAmountCents: number,
  ratio: number,
): number | null {
  if (metadata?.kind !== 'ai_credits') return null;
  const fromMeta = Number(metadata.credit_nanos ?? '');
  if (Number.isFinite(fromMeta) && fromMeta > 0) return Math.round(fromMeta);
  const fromAmount = creditNanosForPaymentCents(chargeAmountCents, ratio);
  return fromAmount > 0 ? fromAmount : null;
}

/** Share of the pack a single refund or dispute takes back. */
export function creditRefundDebitNanos(
  chargeAmountCents: number,
  refundAmountCents: number,
  grantedCreditNanos: number,
): number {
  if (chargeAmountCents <= 0 || refundAmountCents <= 0 || grantedCreditNanos <= 0) return 0;
  const share = Math.min(refundAmountCents, chargeAmountCents) / chargeAmountCents;
  return Math.round(grantedCreditNanos * share);
}

export function creditPackRefundLegs(input: {
  chargeAmountCents: number;
  grantedCreditNanos: number;
  refunds: Array<{ id: string; amountCents: number; status?: string | null }>;
}): Array<{ refundId: string; debitNanos: number }> {
  const legs: Array<{ refundId: string; debitNanos: number }> = [];
  for (const refund of input.refunds) {
    if (!refund.id) continue;
    const status = refund.status ?? 'succeeded';
    if (status === 'failed' || status === 'canceled' || status === 'cancelled') continue;
    const debitNanos = creditRefundDebitNanos(
      input.chargeAmountCents,
      refund.amountCents,
      input.grantedCreditNanos,
    );
    if (debitNanos <= 0) continue;
    legs.push({ refundId: refund.id, debitNanos });
  }
  return legs;
}

export interface CreditLedgerEntry {
  stripeEventId: string | null;
  requestId: string | null;
  deltaNanos: number;
}

/** Replay-safe grant. A second delivery of the same Stripe event does not mint again. */
export function applyCreditGrant(input: {
  entries: CreditLedgerEntry[];
  stripeEventId: string;
  deltaNanos: number;
}): { entries: CreditLedgerEntry[]; balanceNanos: number; applied: boolean } {
  const existing = input.entries.some((row) => row.stripeEventId === input.stripeEventId);
  const entries = existing
    ? input.entries
    : [
        ...input.entries,
        { stripeEventId: input.stripeEventId, requestId: null, deltaNanos: input.deltaNanos },
      ];
  return {
    entries,
    balanceNanos: entries.reduce((sum, row) => sum + row.deltaNanos, 0),
    applied: !existing,
  };
}

export function creditGrantFromCheckout(session: {
  id?: string | null;
  mode?: string | null;
  amount_total?: number | null;
  payment_status?: string | null;
  metadata?: Record<string, string> | null;
}, ratio: number): { sessionId: string; paidCents: number; creditNanos: number } | null {
  if (session.metadata?.kind !== 'ai_credits') return null;
  if (session.mode && session.mode !== 'payment') return null;
  const status = session.payment_status ?? 'paid';
  if (status !== 'paid' && status !== 'no_payment_required') return null;
  const sessionId = session.id ?? '';
  if (!sessionId) return null;
  const fromMeta = Number(session.metadata.pack_cents ?? '');
  const paidCents =
    Number.isFinite(fromMeta) && fromMeta > 0 ? fromMeta : Math.max(0, session.amount_total ?? 0);
  const creditNanos = creditNanosForPaymentCents(paidCents, ratio);
  if (creditNanos <= 0) return null;
  return { sessionId, paidCents, creditNanos };
}

/** Org owners (Global Admins, including the legacy office-manager role) may buy or upgrade. */
export function canPurchaseAiCredits(role: string | null | undefined): boolean {
  return canManageBilling(role);
}

/** Atmosphere staff on the internal scope may grant credits. Investors cannot. */
export function canGrantAiCredits(scope: string | null | undefined): boolean {
  return scope === 'internal';
}

export function customerAllowanceMessage(input: {
  state: AllowanceState;
  resetAt: Date | null;
  canManage: boolean;
  rollingLimited: boolean;
}): string | null {
  const when = input.resetAt
    ? input.resetAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : 'the next renewal';
  if (input.state === 'limited') {
    const action = input.canManage
      ? 'Upgrade the plan or buy credits to continue.'
      : 'An owner can upgrade the plan or buy credits.';
    if (input.rollingLimited) {
      return `AI is paused because this account hit its daily usage limit. Uploaded videos are saved and will be analyzed when usage is available. ${action}`;
    }
    return `AI is paused until the usage allowance resets on ${when}. Uploaded videos are saved and will be analyzed when the allowance is available. ${action}`;
  }
  if (input.state === 'credits') {
    return 'The included allowance for this period is used up. Extra credits are covering AI until they run out.';
  }
  if (input.state === 'warning') {
    if (input.rollingLimited) {
      return 'This account is close to its daily usage limit. AI keeps working until the limit, then pauses unless you buy credits.';
    }
    return `This account has used most of its AI allowance for this period. It resets on ${when}.`;
  }
  return null;
}

export const AI_FEATURE_LABELS: Record<string, string> = {
  ask: 'Ask',
  research: 'Research',
  video_analysis: 'Video analysis',
  transcription: 'Transcription',
  document_analysis: 'Document analysis',
  web_search: 'Web search',
  chat: 'Chat',
  other: 'Other',
};

export function featureLabel(feature: string): string {
  return AI_FEATURE_LABELS[feature] ?? 'Other';
}
