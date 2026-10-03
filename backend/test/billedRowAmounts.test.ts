/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles for the Supabase client */
/**
 * Every billed row = provider-reported usage × the official price × 10.
 *
 * The token counts below are the exact counts of production ledger rows that
 * Settings › Billing and Analytics showed with wrong amounts (Gemini rows
 * priced at the Gemini 2.5 Flash-Lite rate, Claude rows at $0). Prices: Gemini
 * Developer API paid tier and Claude API standard pricing (rate card verified
 * 2026-10-02), Tavily pay-as-you-go $0.008 per credit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  modelPriceTable,
  tavilyBilledCredits,
  tavilyCreditsCostNanos,
  tavilyDocumentedCredits,
} from '../src/metering/modelPriceTable.js';
import { customerPriceNanos, providerCostForUsage } from '../src/metering/pricing.js';

const billed = (model: string, inputTokens: number, outputTokens: number, cacheReadTokens = 0) => {
  const quote = providerCostForUsage(model, { inputTokens, outputTokens, cacheReadTokens } as any, '2026-09-20T00:00:00Z');
  assert.equal(quote.priced, true, `${model} is on the rate card`);
  return { cost: quote.costNanos, price: customerPriceNanos(quote.costNanos, 10) };
};

test('gemini-3.5-flash-lite: $0.30 in / $2.50 out per MTok × 10', () => {
  // 1,985 in + 250 out: was stored at $0.002985 billed ($0.10/$0.40 rate).
  assert.deepEqual(billed('gemini-3.5-flash-lite', 1985, 250), { cost: 1_220_500, price: 12_205_000 });
});

test('gemini-3.6-flash: $0.75 in / $3.75 out per MTok × 10 (through 2026-12-31)', () => {
  // 1,357 in + 132 out: was stored at $0.00189 billed.
  assert.deepEqual(billed('gemini-3.6-flash', 1357, 132), { cost: 1_512_750, price: 15_127_500 });
});

test('claude-opus-5: $5 in / $25 out per MTok × 10', () => {
  assert.deepEqual(billed('claude-opus-5', 7582, 815), { cost: 58_285_000, price: 582_850_000 });
});

test('claude-sonnet-5: $2 in / $10 out, cache reads 0.1× input, × 10', () => {
  assert.deepEqual(billed('claude-sonnet-5', 6629, 1158, 2825), { cost: 25_403_000, price: 254_030_000 });
});

test('Tavily: credits × $0.008 × 10, by call type', () => {
  const table = modelPriceTable();
  assert.equal(table.tavilyUsdPerCredit, 0.008);
  assert.equal(tavilyDocumentedCredits({ endpoint: 'search', depth: 'basic' }), 1);
  assert.equal(tavilyDocumentedCredits({ endpoint: 'search', depth: 'advanced' }), 2);
  assert.equal(tavilyDocumentedCredits({ endpoint: 'extract', depth: 'basic', successfulUrls: 5 }), 1);
  assert.equal(tavilyDocumentedCredits({ endpoint: 'extract', depth: 'basic', successfulUrls: 6 }), 2);
  assert.equal(tavilyDocumentedCredits({ endpoint: 'extract', depth: 'advanced', successfulUrls: 10 }), 4);
  assert.equal(tavilyDocumentedCredits({ endpoint: 'extract', depth: 'advanced', successfulUrls: 0 }), 0);
  // One basic search: $0.008 cost, $0.08 billed.
  assert.equal(tavilyCreditsCostNanos(table, 1), 8_000_000);
  assert.equal(customerPriceNanos(tavilyCreditsCostNanos(table, 1), 10), 80_000_000);
  // Advanced search: $0.016 cost, $0.16 billed.
  assert.equal(customerPriceNanos(tavilyCreditsCostNanos(table, 2), 10), 160_000_000);
  // Tavily's own usage.credits wins over the table.
  assert.deepEqual(tavilyBilledCredits({ endpoint: 'search', depth: 'basic' }, 2), { credits: 2, reportedByProvider: true });
  assert.deepEqual(tavilyBilledCredits({ endpoint: 'search', depth: 'basic' }, undefined), { credits: 1, reportedByProvider: false });
});
