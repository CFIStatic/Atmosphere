/**
 * Customer token markup.
 *
 * Atmosphere stores provider COGS and the customer charge separately so the
 * multiplier can change later without rewriting history. Default is 10×
 * (~90% gross margin on usage). Seat / Stripe subscription prices are
 * unrelated — this applies only to token_usage_events.
 *
 * Override with USAGE_CUSTOMER_MARKUP or TOKEN_BILLABLE_MARKUP.
 */

export const DEFAULT_USAGE_CUSTOMER_MARKUP = 10;

export function usageCustomerMarkup(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.USAGE_CUSTOMER_MARKUP ?? env.TOKEN_BILLABLE_MARKUP;
  if (raw === undefined || raw === '') return DEFAULT_USAGE_CUSTOMER_MARKUP;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_USAGE_CUSTOMER_MARKUP;
  return n;
}

/** Customer/billable nanodollars = round(provider cost × markup). */
export function billableNanosFromCost(
  costNanos: number,
  markup: number = usageCustomerMarkup(),
): number {
  if (!Number.isFinite(costNanos) || costNanos <= 0) return 0;
  if (!Number.isFinite(markup) || markup < 1) return Math.round(costNanos);
  return Math.round(costNanos * markup);
}

/**
 * Resolve the two ledger amounts for one event.
 *
 * - `costNanos` is provider/COGS.
 * - `priceNanos` is the customer charge. When omitted, it is cost × markup.
 * - Legacy callers that only passed `priceNanos` (when that column held COGS)
 *   are treated as cost-only so they pick up the current markup.
 */
export function resolveTokenLedgerAmounts(input: {
  costNanos?: number | null;
  priceNanos?: number | null;
}): { costNanos: number; priceNanos: number } {
  const hasCost = input.costNanos != null && Number.isFinite(input.costNanos);
  const hasPrice = input.priceNanos != null && Number.isFinite(input.priceNanos);
  const cost = Math.max(0, Math.round(hasCost ? Number(input.costNanos) : hasPrice ? Number(input.priceNanos) : 0));
  if (hasCost && hasPrice) {
    return { costNanos: cost, priceNanos: Math.max(0, Math.round(Number(input.priceNanos))) };
  }
  return { costNanos: cost, priceNanos: billableNanosFromCost(cost) };
}
