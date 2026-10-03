/**
 * Customer price = verified provider cost × markup — computed HERE only.
 *
 * Every reader and writer of AI money goes through this module:
 *  - the write path (`recordTokenUsage` / `recordMeasuredTokenUsage`, video
 *    analysis, flat Tavily/transcription fees) prices a call once and stores
 *    `cost_nanos` and `price_nanos` on token_usage_events;
 *  - Settings › Billing (`aggregateTokenUsage`), the AI allowance
 *    (`settle_ai_usage` draws down `cost_nanos`), Stripe same-day usage
 *    invoices (sum of stored `price_nanos`) and Internal Analytics all read
 *    those stored amounts, and use `eventAmounts` below for any legacy row that
 *    still has tokens but no stored price.
 *
 * So Billing, the allowance, Analytics and invoicing cannot drift: there is a
 * single cost function (`providerCostForUsage`, rate card in
 * modelPriceTable.ts) and a single markup function (`customerPriceNanos`).
 */

import type { MeasuredUsage, ProviderUsageCall } from '../lib/anthropic.js';
import { billableNanosFromCost, usageCustomerMarkup } from './customerMarkup.js';
import { modelPriceTable, RATE_CARD_VERIFIED_AT, tokenCostUsd, usdToNanos, type TokenCounts } from './modelPriceTable.js';

/** Anthropic server-side web search: $10 per 1,000 searches. */
export const ANTHROPIC_WEB_SEARCH_USD = 0.01;

export interface CostQuote {
  /** Provider cost in nanodollars (sum of every priced call). */
  costNanos: number;
  /** False when at least one call's model is not on the rate card. */
  priced: boolean;
  /** Model ids that had tokens but no price. Must be surfaced, never hidden. */
  unpricedModels: string[];
  rateCardVerifiedAt: string;
}

function callTokens(call: ProviderUsageCall): TokenCounts {
  return {
    inputTokens: call.inputTokens,
    outputTokens: call.outputTokens,
    cacheReadTokens: call.cacheReadTokens,
    cacheWrite5mTokens: call.cacheWrite5mTokens,
    cacheWrite1hTokens: call.cacheWrite1hTokens,
    audioInputTokens: call.audioInputTokens,
    promptTokens: call.promptTokens,
  };
}

function hasTokens(t: TokenCounts): boolean {
  return (
    (t.inputTokens ?? 0) + (t.outputTokens ?? 0) + (t.cacheReadTokens ?? 0) +
      (t.cacheWrite5mTokens ?? 0) + (t.cacheWrite1hTokens ?? 0) + (t.cacheTokens ?? 0) >
    0
  );
}

/**
 * Provider cost of provider-reported usage. Each provider call is priced at
 * its own model's rate in force at `at`; calls without a model use `modelId`.
 */
export function providerCostForUsage(
  modelId: string | null | undefined,
  usage: MeasuredUsage | TokenCounts,
  at: Date | string | null = null,
): CostQuote {
  const table = modelPriceTable();
  const calls = (usage as MeasuredUsage).calls;
  let usd = 0;
  const unpriced = new Set<string>();
  const priceOne = (model: string | null | undefined, tokens: TokenCounts) => {
    if (!hasTokens(tokens)) return;
    const cost = tokenCostUsd(table, { modelId: model, tokens, at });
    if (cost == null) unpriced.add((model ?? '').trim() || '(unknown model)');
    else usd += cost;
  };
  if (calls && calls.length) {
    for (const call of calls) {
      priceOne(call.model ?? modelId, callTokens(call));
      if (call.webSearchRequests) usd += call.webSearchRequests * ANTHROPIC_WEB_SEARCH_USD;
    }
  } else {
    priceOne(modelId, usage as TokenCounts);
  }
  return {
    costNanos: usdToNanos(usd),
    priced: unpriced.size === 0,
    unpricedModels: [...unpriced],
    rateCardVerifiedAt: RATE_CARD_VERIFIED_AT,
  };
}

/** Customer charge for a provider cost. The only markup function. */
export function customerPriceNanos(costNanos: number, markup: number = usageCustomerMarkup()): number {
  return billableNanosFromCost(costNanos, markup);
}

export interface LedgerRowAmounts {
  priceNanos: number;
  costNanos: number;
  modelId: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  cacheReadTokens?: number;
  cacheWrite5mTokens?: number;
  cacheWrite1hTokens?: number;
  createdAt?: string | null;
}

/**
 * Cost and price for one ledger row, as every report must show it.
 * Stored amounts win. A legacy row that has tokens but $0 is re-priced from
 * the rate card (cache without a split priced as reads — the conservative,
 * never-over-charge assumption) and marked up once.
 */
export function eventAmounts(row: LedgerRowAmounts): { costNanos: number; priceNanos: number; repriced: boolean } {
  const storedCost = row.costNanos > 0 ? row.costNanos : 0;
  if (row.priceNanos > 0) return { costNanos: storedCost, priceNanos: row.priceNanos, repriced: false };
  if (storedCost > 0) return { costNanos: storedCost, priceNanos: customerPriceNanos(storedCost), repriced: false };
  const quote = providerCostForUsage(
    row.modelId,
    {
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheTokens: row.cacheTokens,
      cacheReadTokens: row.cacheReadTokens,
      cacheWrite5mTokens: row.cacheWrite5mTokens,
      cacheWrite1hTokens: row.cacheWrite1hTokens,
    },
    row.createdAt ?? null,
  );
  return { costNanos: quote.costNanos, priceNanos: customerPriceNanos(quote.costNanos), repriced: quote.costNanos > 0 };
}

/** Billable nanodollars for one ledger row (Settings › Billing, Analytics). */
export function eventBillableNanos(row: LedgerRowAmounts): number {
  return eventAmounts(row).priceNanos;
}
