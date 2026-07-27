import type { PostgrestError } from '@supabase/supabase-js';
import { HttpError, badRequest, forbidden, notFound, paymentRequired } from './errors.js';
import { toNanos } from './money.js';

/**
 * Translation layer between the database's billing functions and HTTP.
 *
 * The SQL functions raise bare, stable identifiers (`insufficient_credits`,
 * `billing_forbidden`, …) rather than prose, precisely so this mapping can be
 * exhaustive and the wording can change without breaking the API. Anything not
 * on this list is treated as an internal error and its detail is NOT forwarded
 * to the client — database messages can contain balances and limits we would
 * rather shape deliberately.
 */
const ERROR_MAP: Record<string, (detail?: string) => HttpError> = {
  insufficient_credits: () =>
    paymentRequired(
      'Not enough credits to complete this request. Top up your balance to continue.',
      'insufficient_credits',
    ),
  spend_limit_exceeded: () =>
    paymentRequired(
      'This request would exceed the monthly spend limit set for your organization.',
      'spend_limit_exceeded',
    ),
  billing_forbidden: () =>
    forbidden(
      'Your role cannot manage billing. Ask an accountant or office manager on your team.',
      'billing_forbidden',
    ),
  payment_confirmation_forbidden: () =>
    forbidden('Payments are confirmed by the payment provider.', 'payment_confirmation_forbidden'),
  not_a_member: () => forbidden('You are not a member of this organization.', 'not_a_member'),
  unknown_model: (detail) => badRequest(`Unknown model: ${detail ?? 'unrecognised'}`, 'unknown_model'),
  model_inactive: (detail) => badRequest(`Model is not available: ${detail ?? ''}`, 'model_inactive'),
  unknown_plan: (detail) => badRequest(`Unknown plan: ${detail ?? ''}`, 'unknown_plan'),
  unknown_pack: (detail) => badRequest(`Unknown credit pack: ${detail ?? ''}`, 'unknown_pack'),
  unknown_purchase: () => notFound('That purchase does not exist.', 'unknown_purchase'),
  purchase_not_pending: () =>
    badRequest('That purchase has already been settled.', 'purchase_not_pending'),
  plan_requires_sales: () =>
    badRequest('That plan is arranged with our sales team.', 'plan_requires_sales'),
  seats_below_minimum: (detail) =>
    badRequest(`That plan has a seat minimum (${detail ?? ''}).`, 'seats_below_minimum'),
  amount_below_minimum: () => badRequest('The minimum top-up is $5.', 'amount_below_minimum'),
  amount_above_maximum: () =>
    badRequest('That top-up is above the single-purchase maximum.', 'amount_above_maximum'),
  request_id_required: () =>
    badRequest('A request_id is required so usage is not double-billed.', 'request_id_required'),
};

/**
 * Convert a Supabase/Postgres error from a billing RPC into an HttpError.
 * `message` carries the identifier raised by the function; `details` carries
 * the structured context.
 */
export function billingError(error: PostgrestError): HttpError {
  const key = (error.message ?? '').trim();
  const build = ERROR_MAP[key];
  if (build) return build(error.details ?? undefined);

  if (/not authenticated/i.test(key)) {
    return new HttpError(401, 'Not authenticated', 'unauthorized');
  }

  // Unmapped — log server-side, return something generic.
  console.error('[billing] unmapped database error', error);
  return new HttpError(500, 'Billing operation failed', 'billing_failed');
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Shape the `credit_balance` JSON into camelCase numbers. */
export function serializeBalance(raw: any) {
  return {
    totalNanos: toNanos(raw?.total_nanos ?? 0),
    planNanos: toNanos(raw?.plan_nanos ?? 0),
    purchasedNanos: toNanos(raw?.purchased_nanos ?? 0),
    promoNanos: toNanos(raw?.promo_nanos ?? 0),
    nextExpiry: (raw?.next_expiry as string | null) ?? null,
  };
}

export function serializePlan(row: any) {
  return {
    code: row.code as string,
    name: row.name as string,
    tagline: (row.tagline as string | null) ?? null,
    monthlyPriceCents: row.monthly_price_cents as number,
    annualPriceCents: (row.annual_price_cents as number | null) ?? null,
    includedCreditsNanos: toNanos(row.included_credits_nanos),
    perSeat: Boolean(row.per_seat),
    minSeats: row.min_seats as number,
    rateMultiplier: Number(row.rate_multiplier),
    features: (row.features as string[]) ?? [],
    isContactSales: Boolean(row.is_contact_sales),
  };
}

export function serializePack(row: any) {
  return {
    code: row.code as string,
    name: row.name as string,
    priceCents: row.price_cents as number,
    creditsNanos: toNanos(row.credits_nanos),
    bonusNanos: toNanos(row.bonus_nanos),
  };
}

export function serializeRate(row: any) {
  return {
    modelId: row.model_id as string,
    displayName: row.display_name as string,
    family: row.family as string,
    inputPerMTok: Number(row.input_price_per_mtok),
    outputPerMTok: Number(row.output_price_per_mtok),
    cacheWrite5mPerMTok: Number(row.cache_write_5m_price_per_mtok),
    cacheWrite1hPerMTok: Number(row.cache_write_1h_price_per_mtok),
    cacheReadPerMTok: Number(row.cache_read_price_per_mtok),
    batchDiscountPct: Number(row.batch_discount_pct),
    contextWindow: (row.context_window as number | null) ?? null,
    maxOutputTokens: (row.max_output_tokens as number | null) ?? null,
  };
}

export function serializeOverview(raw: any) {
  const sub = raw?.subscription ?? {};
  const settings = raw?.settings ?? {};
  const usage = raw?.period_usage ?? {};
  return {
    subscription: {
      planCode: sub.plan_code as string,
      planName: sub.plan_name as string,
      billingInterval: sub.billing_interval as 'monthly' | 'annual',
      seats: sub.seats as number,
      status: sub.status as string,
      periodStart: sub.period_start as string,
      periodEnd: sub.period_end as string,
      cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
      monthlyPriceCents: sub.monthly_price_cents as number,
      includedCreditsNanos: toNanos(sub.included_credits_nanos ?? 0),
      rateMultiplier: Number(sub.rate_multiplier ?? 1),
    },
    settings: {
      autoReloadEnabled: Boolean(settings.auto_reload_enabled),
      autoReloadThresholdNanos: toNanos(settings.auto_reload_threshold_nanos ?? 0),
      autoReloadAmountNanos: toNanos(settings.auto_reload_amount_nanos ?? 0),
      monthlySpendLimitNanos:
        settings.monthly_spend_limit_nanos === null || settings.monthly_spend_limit_nanos === undefined
          ? null
          : toNanos(settings.monthly_spend_limit_nanos),
    },
    balance: serializeBalance(raw?.balance),
    periodUsage: {
      events: Number(usage.events ?? 0),
      priceNanos: toNanos(usage.price_nanos ?? 0),
      inputTokens: Number(usage.input_tokens ?? 0),
      outputTokens: Number(usage.output_tokens ?? 0),
      cacheTokens: Number(usage.cache_tokens ?? 0),
    },
    usageByModel: ((raw?.usage_by_model as any[]) ?? []).map((m) => ({
      modelId: m.model_id as string,
      displayName: m.display_name as string,
      events: Number(m.events ?? 0),
      inputTokens: Number(m.input_tokens ?? 0),
      outputTokens: Number(m.output_tokens ?? 0),
      priceNanos: toNanos(m.price_nanos ?? 0),
    })),
    canManage: Boolean(raw?.can_manage),
  };
}
