/**
 * What a customer actually pays per month, from Stripe subscription objects.
 *
 * Pure functions. The Stripe webhook stores the result on
 * org_billing.stripe_mrr_cents; staff analytics (MRR, ARR, ARPA, plan mix,
 * churn) read it from there. Rules (analytics audit 2026-10-07):
 *   - only subscriptions in status active or past_due count (trialing,
 *     incomplete, canceled, unpaid = $0)
 *   - every licensed item is normalised to a month (year / 12, week x 52 / 12,
 *     day x 365 / 12, divided by interval_count); metered items are usage, not
 *     recurring revenue, and are skipped
 *   - tax is excluded: a tax-inclusive price is divided by (1 + inclusive rate)
 *     when the rate is known; exclusive tax is never in the price
 *   - forever and repeating discounts are applied (percent first, then amount
 *     off normalised per month); once-only discounts do not change MRR
 *   - comp_ and test-mode subscriptions are $0 (handled by the caller / SQL)
 *
 * The catalog prices below are the fallback when no Stripe amount is stored.
 * They must match private.atmosphere_catalog_mrr_cents in
 * 20261007230000_analytics_audit_corrections.sql.
 */

export type RecurringInterval = 'day' | 'week' | 'month' | 'year';

export const ATMOSPHERE_CATALOG_MONTHLY_CENTS: Record<string, number> = {
  starter: 39_900,
  work_verification: 84_900,
  scale: 199_900,
};
export const EXTRA_FC_SEAT_MONTHLY_CENTS = 12_500;
/** Annual terms are 10 months' price, prepaid. */
export const ANNUAL_MONTHS_CHARGED = 10;

/** Catalog price per month for a plan; annual = yearly price / 12. */
export function catalogMonthlyCents(
  planCode: string | null | undefined,
  interval: 'month' | 'year' | null | undefined,
  extraSeats: number | null | undefined,
): number {
  const base = ATMOSPHERE_CATALOG_MONTHLY_CENTS[planCode ?? ''] ?? ATMOSPHERE_CATALOG_MONTHLY_CENTS.work_verification;
  const seats = Math.max(0, Math.floor(Number(extraSeats ?? 0)) || 0);
  if (interval === 'year') {
    return Math.round(((base + seats * EXTRA_FC_SEAT_MONTHLY_CENTS) * ANNUAL_MONTHS_CHARGED) / 12);
  }
  return base + seats * EXTRA_FC_SEAT_MONTHLY_CENTS;
}

export interface MrrItem {
  /** Unit amount in cents (may be fractional via unit_amount_decimal). */
  unitAmountCents: number | null;
  quantity: number;
  interval: RecurringInterval | null;
  intervalCount: number;
  usageType: 'licensed' | 'metered' | null;
  taxBehavior: 'inclusive' | 'exclusive' | 'unspecified' | null;
  /** Sum of inclusive tax rate percentages that apply to this item, if known. */
  inclusiveTaxPercent: number | null;
}

export interface MrrDiscount {
  percentOff: number | null;
  /** Amount off per invoice, in cents. */
  amountOffCents: number | null;
  duration: 'forever' | 'repeating' | 'once';
}

export interface MrrSubscription {
  id: string;
  status: string;
  livemode: boolean | null;
  items: MrrItem[];
  discounts: MrrDiscount[];
}

export interface SubscriptionMrr {
  mrrCents: number;
  /** Term of the largest recurring item. */
  interval: 'month' | 'year' | null;
}

export const PAYING_SUBSCRIPTION_STATUSES = new Set(['active', 'past_due']);

/** Months covered by one billing cycle of this interval. */
export function monthsPerCycle(interval: RecurringInterval, count = 1): number {
  const n = Math.max(1, Math.floor(count) || 1);
  switch (interval) {
    case 'year':
      return 12 * n;
    case 'month':
      return n;
    case 'week':
      return (12 / 52) * n;
    case 'day':
      return (12 / 365) * n;
  }
}

function itemMonthlyCents(item: MrrItem): number {
  if (item.usageType === 'metered' || !item.interval) return 0;
  const unit = Number(item.unitAmountCents ?? 0);
  if (!Number.isFinite(unit) || unit <= 0) return 0;
  const qty = Math.max(0, Number(item.quantity ?? 1) || 0);
  let perCycle = unit * qty;
  if (item.taxBehavior === 'inclusive' && item.inclusiveTaxPercent && item.inclusiveTaxPercent > 0) {
    perCycle = perCycle / (1 + item.inclusiveTaxPercent / 100);
  }
  return perCycle / monthsPerCycle(item.interval, item.intervalCount);
}

/** Net monthly amount of one subscription, before rounding. */
export function subscriptionMonthlyCents(sub: MrrSubscription): SubscriptionMrr {
  if (!PAYING_SUBSCRIPTION_STATUSES.has(sub.status)) return { mrrCents: 0, interval: null };
  if (sub.livemode === false) return { mrrCents: 0, interval: null };

  let gross = 0;
  let largest = 0;
  let interval: 'month' | 'year' | null = null;
  let cycleMonths = 1;
  for (const item of sub.items) {
    const monthly = itemMonthlyCents(item);
    gross += monthly;
    if (monthly > largest && item.interval) {
      largest = monthly;
      interval = item.interval === 'year' ? 'year' : 'month';
      cycleMonths = monthsPerCycle(item.interval, item.intervalCount);
    }
  }
  if (gross <= 0) return { mrrCents: 0, interval };

  let net = gross;
  for (const d of sub.discounts) {
    if (d.duration === 'once') continue;
    if (d.percentOff && d.percentOff > 0) net *= Math.max(0, 1 - d.percentOff / 100);
  }
  for (const d of sub.discounts) {
    if (d.duration === 'once') continue;
    if (d.amountOffCents && d.amountOffCents > 0) net -= d.amountOffCents / cycleMonths;
  }
  return { mrrCents: Math.max(0, Math.round(net)), interval };
}

/** A customer's MRR: every paying subscription summed. */
export function customerMonthlyCents(subs: MrrSubscription[]): SubscriptionMrr & { livemode: boolean | null } {
  let total = 0;
  let interval: 'month' | 'year' | null = null;
  let biggest = -1;
  let livemode: boolean | null = null;
  for (const sub of subs) {
    if (sub.livemode !== null) livemode = livemode === null ? sub.livemode : livemode || sub.livemode;
    const one = subscriptionMonthlyCents(sub);
    total += one.mrrCents;
    if (one.mrrCents > biggest && one.interval) {
      biggest = one.mrrCents;
      interval = one.interval;
    }
  }
  return { mrrCents: total, interval, livemode };
}

/* ------------------------------------------------------- Stripe adapter -- */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw Stripe objects across API versions
type AnyRecord = Record<string, any>;

function couponOf(discount: unknown): AnyRecord | null {
  if (!discount || typeof discount !== 'object') return null;
  const d = discount as AnyRecord;
  // Pre-2025 API: discount.coupon. 2025+ API: discount.source.coupon.
  const coupon = d.coupon ?? d.source?.coupon ?? null;
  return coupon && typeof coupon === 'object' ? (coupon as AnyRecord) : null;
}

function inclusivePercent(rates: unknown): number | null {
  if (!Array.isArray(rates)) return null;
  let sum = 0;
  let found = false;
  for (const r of rates) {
    if (r && typeof r === 'object' && (r as AnyRecord).inclusive && Number.isFinite(Number((r as AnyRecord).percentage))) {
      sum += Number((r as AnyRecord).percentage);
      found = true;
    }
  }
  return found ? sum : null;
}

/** Map a Stripe.Subscription (any recent API version) to the pure shape. */
export function mrrSubscriptionFromStripe(sub: AnyRecord): MrrSubscription {
  const defaultRates = sub.default_tax_rates;
  const items: MrrItem[] = ((sub.items?.data ?? []) as AnyRecord[]).map((row) => {
    const price = row.price && typeof row.price === 'object' ? (row.price as AnyRecord) : (row.plan as AnyRecord | undefined) ?? {};
    const recurring = (price.recurring ?? {}) as AnyRecord;
    const decimal = price.unit_amount_decimal != null ? Number(price.unit_amount_decimal) : null;
    const unit = price.unit_amount != null ? Number(price.unit_amount) : decimal;
    const iv = recurring.interval ?? price.interval ?? null;
    return {
      unitAmountCents: Number.isFinite(unit as number) ? (unit as number) : null,
      quantity: row.quantity ?? 1,
      interval: iv === 'day' || iv === 'week' || iv === 'month' || iv === 'year' ? iv : null,
      intervalCount: Number(recurring.interval_count ?? price.interval_count ?? 1) || 1,
      usageType: recurring.usage_type === 'metered' || price.usage_type === 'metered' ? 'metered' : 'licensed',
      taxBehavior: price.tax_behavior ?? null,
      inclusiveTaxPercent: inclusivePercent(row.tax_rates?.length ? row.tax_rates : defaultRates),
    };
  });

  const rawDiscounts: unknown[] = [];
  if (Array.isArray(sub.discounts)) rawDiscounts.push(...sub.discounts);
  if (sub.discount && !rawDiscounts.some((d) => (d as AnyRecord)?.id && (d as AnyRecord).id === sub.discount.id)) {
    rawDiscounts.push(sub.discount);
  }
  const discounts: MrrDiscount[] = [];
  for (const raw of rawDiscounts) {
    const coupon = couponOf(raw);
    if (!coupon) continue; // unexpanded id: cannot price it
    const duration = coupon.duration === 'forever' || coupon.duration === 'repeating' ? coupon.duration : 'once';
    discounts.push({
      percentOff: coupon.percent_off != null ? Number(coupon.percent_off) : null,
      amountOffCents: coupon.amount_off != null ? Number(coupon.amount_off) : null,
      duration,
    });
  }

  return {
    id: String(sub.id ?? ''),
    status: String(sub.status ?? ''),
    livemode: typeof sub.livemode === 'boolean' ? sub.livemode : null,
    items,
    discounts,
  };
}
