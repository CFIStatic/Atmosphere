/**
 * Provider-reported usage → official rate card → customer price.
 * One pricing path for Billing, the allowance, Analytics and invoicing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extractUsage } from '../src/lib/anthropic.js';
import { geminiMeasuredUsage, mergeMeasuredUsages } from '../src/lib/providerUsage.js';
import { billableNanosFromCost } from '../src/metering/customerMarkup.js';
import {
  modelPriceTable,
  PRICE_SOURCES,
  RATE_CARD_VERIFIED_AT,
  ratesForModel,
  tokenCostUsd,
} from '../src/metering/modelPriceTable.js';
import { customerPriceNanos, eventAmounts, providerCostForUsage } from '../src/metering/pricing.js';
import { applySharedPricingToTokenReport, tokenUsageWindowLabel } from '../src/metering/periodAggregation.js';
import { aggregateTokenUsage, recordMeasuredTokenUsageAsync, type TokenUsageEventRow } from '../src/metering/tokenUsage.js';
import { buildReconciliation, compareCost, CONNECTORS } from '../src/metering/reconciliation.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function captureErrors<T>(fn: () => Promise<T> | T): Promise<{ result: T; logs: string[] }> {
  const logs: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };
  return Promise.resolve()
    .then(fn)
    .then((result) => ({ result, logs }))
    .finally(() => {
      console.error = original;
    });
}

// ── Provider-reported usage ────────────────────────────────────────────────

test('a Claude Ask turn is priced from the Anthropic usage object, non-zero, with cache read/write split', () => {
  const raw = {
    input_tokens: 1000,
    output_tokens: 100,
    cache_read_input_tokens: 2000,
    cache_creation_input_tokens: 400,
    cache_creation: { ephemeral_5m_input_tokens: 400, ephemeral_1h_input_tokens: 0 },
  };
  const usage = extractUsage(raw, 'claude-opus-5');
  assert.equal(usage.provider, 'anthropic');
  assert.equal(usage.inputTokens, 1000);
  assert.equal(usage.outputTokens, 100);
  assert.equal(usage.cacheReadTokens, 2000);
  assert.equal(usage.cacheWrite5mTokens, 400);
  assert.deepEqual(usage.calls?.[0]?.raw, raw);

  const quote = providerCostForUsage('claude-opus-5', usage);
  // Opus 5: $5 in, $25 out, read 0.1× ($0.50), 5m write 1.25× ($6.25) per M.
  const expected = 1000 * 5_000 + 100 * 25_000 + 2000 * 500 + 400 * 6_250;
  assert.equal(quote.costNanos, expected);
  assert.equal(quote.priced, true);
  assert.equal(customerPriceNanos(quote.costNanos, 10), expected * 10);
});

test('Claude Opus 1000 in / 100 out costs $0.0075 and bills $0.075 at 10×', () => {
  const quote = providerCostForUsage('claude-opus-5', { inputTokens: 1000, outputTokens: 100 });
  assert.equal(quote.costNanos, 5_000_000 + 2_500_000);
  assert.equal(customerPriceNanos(quote.costNanos, 10), 75_000_000);
});

test('Gemini usageMetadata: cached tokens are subtracted from the prompt and thinking tokens are output', () => {
  const meta = {
    promptTokenCount: 10_000,
    cachedContentTokenCount: 4_000,
    candidatesTokenCount: 500,
    thoughtsTokenCount: 1_500,
    totalTokenCount: 12_000,
  };
  const usage = geminiMeasuredUsage(meta, 'gemini-3.5-flash-lite');
  assert.equal(usage.provider, 'google');
  assert.equal(usage.inputTokens, 6_000);
  assert.equal(usage.cacheReadTokens, 4_000);
  assert.equal(usage.outputTokens, 2_000);
  assert.equal(usage.cacheWrite5mTokens + usage.cacheWrite1hTokens, 0);
  assert.deepEqual(usage.calls?.[0]?.raw, meta);
  const quote = providerCostForUsage('gemini-3.5-flash-lite', usage);
  assert.equal(quote.costNanos, 6_000 * 300 + 2_000 * 2_500 + 4_000 * 30);
});

test('a turn that spans two models is priced call by call at each model’s own rate', () => {
  const lookup = geminiMeasuredUsage({ promptTokenCount: 1_000, candidatesTokenCount: 100 }, 'gemini-3.5-flash-lite');
  const answer = extractUsage({ input_tokens: 1_000, output_tokens: 100 }, 'claude-sonnet-5');
  const merged = mergeMeasuredUsages([lookup, answer], 'claude-sonnet-5');
  assert.ok(merged);
  assert.equal(merged.calls?.length, 2);
  assert.equal(merged.inputTokens, 2_000);
  const quote = providerCostForUsage('claude-sonnet-5', merged);
  const gemini = 1_000 * 300 + 100 * 2_500;
  const sonnet = 1_000 * 2_000 + 100 * 10_000;
  assert.equal(quote.costNanos, gemini + sonnet);
});

// ── Official rate card ─────────────────────────────────────────────────────

test('rate card matches the official prices verified on 2026-10-05', () => {
  const table = modelPriceTable();
  const at = '2026-10-05T12:00:00Z';
  const expect: Record<string, [number, number, number]> = {
    'claude-opus-5-5': [4, 20, 0.4],
    'claude-sonnet-5-5': [2, 10, 0.2],
    'claude-opus-5': [5, 25, 0.5],
    'claude-sonnet-5': [2, 10, 0.2],
    'gemini-3.8-flash': [0.75, 3.75, 0.075],
    'gemini-3.1-pro-preview': [2, 12, 0.2],
    'claude-opus-4-8': [5, 25, 0.5],
    'claude-sonnet-4-6': [3, 15, 0.3],
    'claude-haiku-4-5': [1, 5, 0.1],
    'gemini-3.6-flash': [0.75, 3.75, 0.075],
    'gemini-3.5-flash-lite': [0.3, 2.5, 0.03],
    'gemini-3.5-flash': [1.5, 9, 0.15],
  };
  for (const [model, [inp, out, read]] of Object.entries(expect)) {
    const r = ratesForModel(table, model, at);
    assert.ok(r, `${model} must be on the rate card`);
    assert.deepEqual([r.inputPerMTok, r.outputPerMTok, r.cacheReadPerMTok], [inp, out, read], model);
  }
  assert.equal(ratesForModel(table, 'claude-opus-5', at)?.cacheWrite5mPerMTok, 6.25);
  assert.equal(ratesForModel(table, 'claude-opus-5', at)?.cacheWrite1hPerMTok, 10);
  assert.equal(ratesForModel(table, 'claude-sonnet-5-20260801', at)?.inputPerMTok, 2, 'dated snapshot ids resolve');
  assert.equal(RATE_CARD_VERIFIED_AT, '2026-10-05');
  assert.match(PRICE_SOURCES.anthropic, /^https:\/\/platform\.claude\.com\//);
  assert.match(PRICE_SOURCES.google, /^https:\/\/ai\.google\.dev\//);
});

test('gemini-3.6-flash moves to $1.50 / $7.50 on 2027-01-01 and calls are priced at call time', () => {
  const table = modelPriceTable();
  assert.equal(ratesForModel(table, 'gemini-3.6-flash', '2026-12-31T23:59:59Z')?.inputPerMTok, 0.75);
  assert.equal(ratesForModel(table, 'gemini-3.6-flash', '2027-01-01T00:00:00Z')?.inputPerMTok, 1.5);
  assert.equal(ratesForModel(table, 'gemini-3.6-flash', '2027-01-01T00:00:00Z')?.outputPerMTok, 7.5);
  const before = eventAmounts({
    priceNanos: 0, costNanos: 0, modelId: 'gemini-3.6-flash',
    inputTokens: 1_000_000, outputTokens: 0, cacheTokens: 0, createdAt: '2026-12-31T12:00:00Z',
  });
  const after = eventAmounts({
    priceNanos: 0, costNanos: 0, modelId: 'gemini-3.6-flash',
    inputTokens: 1_000_000, outputTokens: 0, cacheTokens: 0, createdAt: '2027-01-02T12:00:00Z',
  });
  assert.equal(before.costNanos, 750_000_000);
  assert.equal(after.costNanos, 1_500_000_000);
});

test('long-context tier applies above 200k prompt tokens (Gemini 2.5 Pro)', () => {
  const table = modelPriceTable();
  const small = tokenCostUsd(table, { modelId: 'gemini-2.5-pro', tokens: { inputTokens: 200_000, outputTokens: 0 } });
  const large = tokenCostUsd(table, { modelId: 'gemini-2.5-pro', tokens: { inputTokens: 200_001, outputTokens: 1_000 } });
  assert.equal(small, 0.25);
  assert.ok(Math.abs((large ?? 0) - (200_001 * 2.5 + 1_000 * 15) / 1e6) < 1e-12);
});

test('a model with no price is flagged loudly, recorded as unpriced, never silently $0', async () => {
  const quote = providerCostForUsage('mystery-model-9', { inputTokens: 100, outputTokens: 10 });
  assert.equal(quote.priced, false);
  assert.deepEqual(quote.unpricedModels, ['mystery-model-9']);

  const rpcs: Array<{ name: string; params: Record<string, unknown> }> = [];
  const client = {
    rpc: async (name: string, params: Record<string, unknown>) => {
      rpcs.push({ name, params });
      return { data: { eventId: 'evt-x', duplicate: false }, error: null };
    },
  } as any;
  const { logs } = await captureErrors(() =>
    recordMeasuredTokenUsageAsync(client, {
      orgId: 'org-1',
      requestId: 'ask:unknown',
      feature: 'ask',
      modelId: 'mystery-model-9',
      usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, totalTokens: 110 },
    }),
  );
  assert.ok(logs.some((line) => line.includes('ALERT')), `expected an ALERT log, got ${logs.join('\n')}`);
  const record = rpcs.find((row) => row.name === 'record_token_usage');
  assert.equal(record?.params.p_pricing_status, 'unpriced');
  assert.equal(record?.params.p_cost_nanos, 0);
  assert.deepEqual((record?.params.p_metadata as any)?.pricing?.unpricedModels, ['mystery-model-9']);
});

test('the migration rate card matches the backend rate card for every row it writes', () => {
  const files = [
    '20261003020000_provider_usage_and_rate_card.sql',
    '20261005130000_rate_card_claude_5_5_gemini_3.sql',
  ];
  const rowRe = /\(\s*'([a-z0-9.-]+)',\s*'[^']*',\s*'[a-z]+',\s*'(anthropic|google)',\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),[^)]*'(https:[^']+)',\s*'(\d{4}-\d{2}-\d{2})'\)/g;
  const rows = files.flatMap((file) => {
    const sql = readFileSync(path.join(here, '../../supabase/migrations', file), 'utf8');
    return [...sql.matchAll(rowRe)];
  });
  assert.ok(rows.length >= 8, `parsed ${rows.length} rate-card rows`);
  const table = modelPriceTable();
  let newestVerified = '';
  for (const [, model, provider, inp, out, w5, w1, read, url, verified] of rows) {
    const r = ratesForModel(table, model, `${verified}T12:00:00Z`);
    assert.ok(r, `${model} is in the SQL card but not the backend card`);
    assert.equal(Number(inp), r.inputPerMTok, `${model} input`);
    assert.equal(Number(out), r.outputPerMTok, `${model} output`);
    const base = Number(inp);
    assert.ok(Math.abs(base * Number(read) - r.cacheReadPerMTok) < 1e-9, `${model} cache read`);
    assert.ok(Math.abs(base * Number(w5) - r.cacheWrite5mPerMTok) < 1e-9, `${model} 5m write`);
    assert.ok(Math.abs(base * Number(w1) - r.cacheWrite1hPerMTok) < 1e-9, `${model} 1h write`);
    assert.equal(url, provider === 'anthropic' ? PRICE_SOURCES.anthropic : PRICE_SOURCES.google);
    assert.ok(verified <= RATE_CARD_VERIFIED_AT, `${model} verified ${verified} is after ${RATE_CARD_VERIFIED_AT}`);
    if (verified > newestVerified) newestVerified = verified;
  }
  assert.equal(newestVerified, RATE_CARD_VERIFIED_AT);
  for (const used of ['claude-opus-5', 'claude-sonnet-5', 'claude-opus-5-5', 'claude-sonnet-5-5', 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite']) {
    assert.ok(rows.some((row) => row[1] === used), `${used} (in production use) must be in the migration`);
  }
});

test('the 17-row re-price uses cache-as-read and the stored markup', () => {
  // Totals of the 17 production rows (Jettx, Sept 27 – Oct 1) that were stored at $0.
  const opus = providerCostForUsage('claude-opus-5', { inputTokens: 60_713, outputTokens: 7_463, cacheTokens: 16_317 });
  const sonnet = providerCostForUsage('claude-sonnet-5', { inputTokens: 20_888, outputTokens: 3_873, cacheTokens: 24_859 });
  assert.equal(opus.costNanos, 498_298_500);
  assert.equal(sonnet.costNanos, 85_477_800);
  assert.equal(customerPriceNanos(opus.costNanos + sonnet.costNanos, 10), 5_837_763_000);
});

// ── One price rule everywhere ──────────────────────────────────────────────

test('customer price is provider cost × markup, the same function Billing and the ledger use', () => {
  for (const cost of [0, 1, 7_500_000, 498_298_500]) {
    assert.equal(customerPriceNanos(cost, 10), billableNanosFromCost(cost, 10));
  }
  assert.equal(eventAmounts({ priceNanos: 0, costNanos: 1_000, modelId: null, inputTokens: 0, outputTokens: 0, cacheTokens: 0 }).priceNanos, customerPriceNanos(1_000));
});

test('Analytics token usage per org equals Settings › Billing for the same window', () => {
  const window = { start: '2026-09-02T00:00:00.000Z', end: '2026-10-02T00:00:00.000Z' };
  const base = {
    orgId: 'org-jettx',
    userId: 'user-1',
    jobId: null,
    source: 'proof_ask',
    feature: 'ask',
    requestId: 'r',
    metadata: {},
    totalTokens: 0,
  };
  const rows: TokenUsageEventRow[] = [
    { ...base, id: 'priced', modelId: 'claude-opus-5', createdAt: '2026-09-10T00:00:00Z', inputTokens: 1000, outputTokens: 100, cacheTokens: 0, costNanos: 7_500_000, priceNanos: 75_000_000 } as TokenUsageEventRow,
    { ...base, id: 'zero', modelId: 'claude-sonnet-5', createdAt: '2026-09-30T00:00:00Z', inputTokens: 2000, outputTokens: 300, cacheTokens: 5000, costNanos: 0, priceNanos: 0 } as TokenUsageEventRow,
    { ...base, id: 'gem', modelId: 'gemini-3.6-flash', createdAt: '2026-09-20T00:00:00Z', inputTokens: 529, outputTokens: 39, cacheTokens: 0, costNanos: 0, priceNanos: 0 } as TokenUsageEventRow,
  ];
  const billing = aggregateTokenUsage(rows, window, []);

  // Analytics: the SQL report sums stored price_nanos; $0 rows come back
  // separately and are priced by the shared function.
  const report: Record<string, unknown> = {
    totals: { priceNanos: 75_000_000, costNanos: 7_500_000, events: 3 },
    byCustomer: [{ orgId: 'org-jettx', priceNanos: 75_000_000, costNanos: 7_500_000 }],
    byUser: [],
    byModel: [],
    byFeature: [],
  };
  const unpriced = rows
    .filter((r) => r.priceNanos === 0)
    .map((r) => ({
      org_id: r.orgId,
      user_id: r.userId,
      model_id: r.modelId,
      feature: r.feature,
      created_at: r.createdAt,
      input_tokens: r.inputTokens,
      output_tokens: r.outputTokens,
      cache_tokens: r.cacheTokens,
    }));
  applySharedPricingToTokenReport(report, unpriced as any, { from: window.start, to: window.end, now: new Date(window.end) });
  const analyticsOrg = (report.byCustomer as Array<{ priceNanos: number }>)[0]!.priceNanos;
  assert.equal(analyticsOrg, billing.totals.priceNanos);
  assert.equal((report.health as { unpricedEvents: number }).unpricedEvents, 0);
  assert.equal((report.health as { repricedEvents: number }).repricedEvents, 2);
  assert.equal((report.window as { label: string }).label, 'Rolling 30 days (UTC)');
});

test('window label distinguishes rolling windows from fixed ranges', () => {
  assert.equal(tokenUsageWindowLabel('2026-09-02T00:00:00Z', '2026-10-02T00:00:00Z', new Date('2026-10-02T00:00:00Z')), 'Rolling 30 days (UTC)');
  assert.notEqual(tokenUsageWindowLabel('2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z', new Date('2026-10-02T00:00:00Z')), 'Rolling 31 days (UTC)');
});

// ── Reconciliation ─────────────────────────────────────────────────────────

test('compareCost flags variance over 2% and when the provider billed nothing', () => {
  assert.deepEqual(compareCost(1.01, 1), { varianceUsd: 0.01, variancePct: 1, flagged: false });
  assert.equal(compareCost(1.03, 1).flagged, true);
  assert.equal(compareCost(0.97, 1).flagged, true);
  assert.equal(compareCost(0.5, 0).flagged, true);
  assert.equal(compareCost(0, 0).flagged, false);
  assert.equal(compareCost(1, null).flagged, false);
});

test('reconciliation shows "not connected" and what each provider needs when no admin keys are set', async () => {
  let fetched = 0;
  const report = await buildReconciliation({
    client: {} as any,
    from: '2026-09-01T00:00:00Z',
    to: '2026-09-03T00:00:00Z',
    env: {},
    fetchFn: (async () => {
      fetched += 1;
      throw new Error('should not fetch');
    }) as any,
    ours: new Map([['anthropic', new Map([['2026-09-01', 1.5]])]]),
    now: new Date('2026-10-02T00:00:00Z'),
  });
  assert.equal(fetched, 0);
  const anthropic = report.providers.find((p) => p.provider === 'anthropic')!;
  assert.equal(anthropic.status, 'not_connected');
  assert.ok(anthropic.requires.some((r) => r.includes('ANTHROPIC_ADMIN_API_KEY')));
  assert.equal(anthropic.days[0]?.oursUsd, 1.5);
  assert.equal(anthropic.days[0]?.theirsUsd, null);
  assert.equal(report.flaggedCount, 0);
  const google = report.providers.find((p) => p.provider === 'google')!;
  assert.equal(google.status, 'not_connected');
  assert.ok(google.requires.some((r) => r.includes('GOOGLE_BILLING_EXPORT_TABLE')));
  assert.deepEqual(CONNECTORS.map((c) => c.provider), ['anthropic', 'google', 'openai', 'tavily']);
});

test('reconciliation compares with the Anthropic cost report (cents) and flags >2% days, not pending ones', async () => {
  const urls: string[] = [];
  const fetchFn = (async (url: string, init: { headers: Record<string, string> }) => {
    urls.push(url);
    assert.equal(init.headers['x-api-key'], 'test-admin-key');
    return {
      ok: true,
      json: async () => ({
        data: [
          { starting_at: '2026-09-01T00:00:00Z', results: [{ amount: '100.000000', currency: 'USD' }] },
          { starting_at: '2026-09-02T00:00:00Z', results: [{ amount: '200.000000', currency: 'USD' }] },
          { starting_at: '2026-09-03T00:00:00Z', results: [{ amount: '50.000000', currency: 'USD' }] },
        ],
        has_more: false,
      }),
    };
  }) as any;
  const report = await buildReconciliation({
    client: {} as any,
    from: '2026-09-01T00:00:00Z',
    to: '2026-09-04T00:00:00Z',
    env: { ANTHROPIC_ADMIN_API_KEY: 'test-admin-key' },
    fetchFn,
    // Day 1 matches ($1.00), day 2 is 10% low, day 3 is within the provider lag.
    ours: new Map([['anthropic', new Map([['2026-09-01', 1.0], ['2026-09-02', 1.8], ['2026-09-03', 0.1]])]]),
    now: new Date('2026-09-04T18:00:00Z'),
  });
  assert.match(urls[0]!, /\/v1\/organizations\/cost_report\?/);
  const anthropic = report.providers.find((p) => p.provider === 'anthropic')!;
  assert.equal(anthropic.status, 'connected');
  const [d1, d2, d3] = anthropic.days;
  assert.deepEqual([d1?.theirsUsd, d1?.flagged], [1, false]);
  assert.deepEqual([d2?.theirsUsd, d2?.variancePct, d2?.flagged], [2, -10, true]);
  assert.deepEqual([d3?.pending, d3?.flagged], [true, false]);
  assert.equal(anthropic.totals.theirsUsd, 3);
  assert.equal(anthropic.totals.oursUsd, 2.8); // settled days only, same days as the provider
  assert.ok(report.flaggedCount >= 1);
});

test('a provider error is reported without echoing the response body', async () => {
  const report = await buildReconciliation({
    client: {} as any,
    from: '2026-09-01T00:00:00Z',
    to: '2026-09-02T00:00:00Z',
    env: { ANTHROPIC_ADMIN_API_KEY: 'k' },
    fetchFn: (async () => ({ ok: false, status: 401, json: async () => ({ secret: 'x' }) })) as any,
    ours: new Map(),
    now: new Date('2026-10-02T00:00:00Z'),
  });
  const anthropic = report.providers.find((p) => p.provider === 'anthropic')!;
  assert.equal(anthropic.status, 'error');
  assert.equal(anthropic.error, 'Anthropic cost_report 401');
});
