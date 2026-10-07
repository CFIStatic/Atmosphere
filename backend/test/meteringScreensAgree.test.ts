/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles for the Supabase client */
/**
 * Settings › Billing and Analytics › Token usage must show the same numbers as
 * the token_usage_events ledger for the same window.
 *
 * Both screens are run through their real server code paths
 * (loadTokenUsageReport for Billing, getAdminTokenUsageAnalytics for
 * Analytics) over one in-memory ledger. The Analytics RPC is stood in by a
 * plain sum over the same rows; supabase/tests/06_token_usage_screens_agree.sh
 * checks the real SQL function against direct ledger sums.
 *
 * The ledger mixes the cases that went wrong in production: Claude rows that
 * were stored at $0 before the rate card fix, priced Claude rows, Gemini rows,
 * a Tavily search ($0.008 cost per credit, ×10 = $0.08 billed) and a video
 * analysis row, plus rows outside the window and in another org.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { getAdminTokenUsageAnalytics } from '../src/metering/periodAggregation.js';
import { eventBillableNanos } from '../src/metering/pricing.js';
import { loadTokenUsageReport, type TokenUsageRange } from '../src/metering/tokenUsage.js';
import { classifyTokenFeature, TOKEN_FEATURES } from '../src/metering/tokenFeatures.js';

type Row = Record<string, any>;

const ORG = '8b2cc105-0000-4000-8000-000000000001';
const OTHER_ORG = '8b2cc105-0000-4000-8000-000000000002';
const USER = '0f000000-0000-4000-8000-000000000001';

const now = Date.now();
const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();
const PERIOD_START = daysAgo(10);
const PERIOD_END = new Date(now + 20 * 86_400_000).toISOString();

function ledgerRow(over: Row): Row {
  return {
    id: over.id,
    org_id: ORG,
    user_id: USER,
    job_id: null,
    request_id: `req-${over.id}`,
    source: 'proof_ask',
    provider: null,
    input_tokens: 0,
    output_tokens: 0,
    cache_tokens: 0,
    cache_read_tokens: 0,
    cache_write_5m_tokens: 0,
    cache_write_1h_tokens: 0,
    cost_nanos: 0,
    price_nanos: 0,
    pricing_status: 'priced',
    ...over,
    total_tokens:
      (over.input_tokens ?? 0) + (over.output_tokens ?? 0) + (over.cache_tokens ?? 0),
  };
}

const LEDGER: Row[] = [
  // In the billing period (and the last 30 days).
  ledgerRow({ id: 'a1', created_at: daysAgo(2), feature: 'ask', model_id: 'claude-opus-5', provider: 'anthropic', input_tokens: 6000, output_tokens: 900, cost_nanos: 52_500_000, price_nanos: 525_000_000 }),
  // Pre-fix Claude row: tokens, stored at $0. Both screens must price it.
  ledgerRow({ id: 'a2', created_at: daysAgo(3), feature: 'ask', model_id: 'claude-sonnet-5', input_tokens: 4000, output_tokens: 600, pricing_status: 'priced' }),
  ledgerRow({ id: 'a3', created_at: daysAgo(4), feature: 'ask', model_id: 'gemini-3.5-flash-lite', input_tokens: 2000, output_tokens: 150, cost_nanos: 252_000, price_nanos: 2_520_000 }),
  ledgerRow({ id: 'w1', created_at: daysAgo(1), feature: 'web_search', source: 'tavily', model_id: 'tavily-search', provider: 'tavily', cost_nanos: 8_000_000, price_nanos: 80_000_000 }),
  ledgerRow({ id: 'v1', created_at: daysAgo(5), feature: 'video_analysis', source: 'proof_analysis', model_id: 'claude-opus-5', provider: 'anthropic', user_id: null, input_tokens: 15000, output_tokens: 700, cost_nanos: 92_500_000, price_nanos: 925_000_000 }),
  // In the last 30 days but before the billing period.
  ledgerRow({ id: 'b1', created_at: daysAgo(20), feature: 'video_analysis', source: 'video_analysis', model_id: 'gemini-3.6-flash', user_id: null, input_tokens: 3000, output_tokens: 400, cost_nanos: 210_000, price_nanos: 2_100_000 }),
  ledgerRow({ id: 'b2', created_at: daysAgo(25), feature: 'ask', model_id: 'claude-opus-5', input_tokens: 7000, output_tokens: 1000 }),
  // Outside every window.
  ledgerRow({ id: 'c1', created_at: daysAgo(45), feature: 'ask', model_id: 'claude-opus-5', input_tokens: 9000, output_tokens: 1000, cost_nanos: 70_000_000, price_nanos: 700_000_000 }),
  // Another org in the window: on Analytics, not on this org's Billing.
  ledgerRow({ id: 'o1', org_id: OTHER_ORG, created_at: daysAgo(2), feature: 'ask', model_id: 'claude-sonnet-5', input_tokens: 1000, output_tokens: 100, cost_nanos: 3_000_000, price_nanos: 30_000_000 }),
];

function inMemoryClient(tables: Record<string, Row[]>) {
  const query = (source: Row[]) => {
    let rows = [...source];
    let lo = 0;
    let hi = Number.POSITIVE_INFINITY;
    const time = (v: unknown) => Date.parse(String(v));
    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), q),
      gt: (c: string, v: number) => ((rows = rows.filter((r) => Number(r[c]) > v)), q),
      gte: (c: string, v: string) => ((rows = rows.filter((r) => time(r[c]) >= time(v))), q),
      lt: (c: string, v: string) => ((rows = rows.filter((r) => time(r[c]) < time(v))), q),
      in: (c: string, vs: unknown[]) => ((rows = rows.filter((r) => vs.includes(r[c]))), q),
      is: (c: string, v: unknown) => ((rows = rows.filter((r) => (r[c] ?? null) === v)), q),
      order: () => q,
      range: (a: number, b: number) => ((lo = a), (hi = b), q),
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: any, reject: any) => {
        const sorted = rows.sort((a, b) => time(a.created_at) - time(b.created_at) || String(a.id).localeCompare(String(b.id)));
        return Promise.resolve({ data: sorted.slice(lo, hi + 1), error: null }).then(resolve, reject);
      },
    };
    return q;
  };

  // Stand-in for public.admin_token_usage_analytics: plain sums of stored columns.
  const analyticsRpc = (from: string, to: string) => {
    const inWindow = tables.token_usage_events.filter(
      (r) => Date.parse(r.created_at) >= Date.parse(from) && Date.parse(r.created_at) < Date.parse(to),
    );
    const bucket = (key: (r: Row) => string, name: string) => {
      const map = new Map<string, Row>();
      for (const r of inWindow) {
        const k = key(r);
        const b = map.get(k) ?? { [name]: k, eventCount: 0, totalTokens: 0, priceNanos: 0, costNanos: 0 };
        b.eventCount += 1;
        b.totalTokens += r.total_tokens;
        b.priceNanos += r.price_nanos;
        b.costNanos += r.cost_nanos;
        map.set(k, b);
      }
      return [...map.values()];
    };
    const [totals] = bucket(() => 'all', 'all');
    return {
      range: { from, to },
      totals: totals ?? { eventCount: 0, totalTokens: 0, priceNanos: 0, costNanos: 0 },
      byCustomer: bucket((r) => r.org_id, 'orgId'),
      byUser: [],
      byModel: bucket((r) => r.model_id ?? '(unknown)', 'model'),
      byFeature: bucket((r) => r.feature, 'feature'),
    };
  };

  return {
    from: (table: string) => query(tables[table] ?? []),
    rpc: async (name: string, args: Record<string, string>) => {
      if (name === 'analytics_internal_orgs') return { data: [], error: null };
      assert.equal(name, 'admin_token_usage_analytics');
      return { data: analyticsRpc(args.p_from, args.p_to), error: null };
    },
  } as any;
}

const client = inMemoryClient({
  token_usage_events: LEDGER,
  org_billing: [{ org_id: ORG, period_start: PERIOD_START, period_end: PERIOD_END }],
  org_members: [{ org_id: ORG, user_id: USER, role: 'owner', profiles: { email: 'owner@example.test', full_name: 'Owner' } }],
  orgs: [{ id: ORG, name: 'Test org' }],
  crm_jobs: [],
  job_proofs: [],
});

/** What the ledger says the org owes for a window: stored price, or the rate card for $0 rows. */
function ledgerTruth(orgId: string, from: string, to: string) {
  const rows = LEDGER.filter(
    (r) => r.org_id === orgId && Date.parse(r.created_at) >= Date.parse(from) && Date.parse(r.created_at) < Date.parse(to),
  );
  const byFeature: Record<string, { events: number; totalTokens: number; priceNanos: number }> = {};
  let priceNanos = 0;
  let totalTokens = 0;
  for (const r of rows) {
    const nanos = eventBillableNanos({
      priceNanos: r.price_nanos,
      costNanos: r.cost_nanos,
      modelId: r.model_id,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      cacheTokens: r.cache_tokens,
      createdAt: r.created_at,
    } as any);
    priceNanos += nanos;
    totalTokens += r.total_tokens;
    const f = classifyTokenFeature(r.feature);
    byFeature[f] ??= { events: 0, totalTokens: 0, priceNanos: 0 };
    byFeature[f].events += 1;
    byFeature[f].totalTokens += r.total_tokens;
    byFeature[f].priceNanos += nanos;
  }
  return { events: rows.length, totalTokens, priceNanos, byFeature };
}

for (const range of ['period', '30d'] as TokenUsageRange[]) {
  test(`Billing and Analytics agree with the ledger for the same window (${range})`, async () => {
    const billing = await loadTokenUsageReport(client, ORG, range);
    const analytics = (await getAdminTokenUsageAnalytics(client, billing.periodStart, billing.periodEnd)) as any;
    const truth = ledgerTruth(ORG, billing.periodStart, billing.periodEnd);
    const customer = analytics.byCustomer.find((c: any) => c.orgId === ORG);

    assert.ok(truth.events > 0);
    // Same window on both screens.
    assert.equal(analytics.window.from, billing.periodStart);
    assert.equal(analytics.window.to, billing.periodEnd);

    // Calls, tokens and dollars: Billing == Analytics (this org) == ledger.
    assert.equal(billing.totals.events, truth.events);
    assert.equal(customer.eventCount, truth.events);
    assert.equal(billing.totals.totalTokens, truth.totalTokens);
    assert.equal(customer.totalTokens, truth.totalTokens);
    assert.equal(billing.totals.priceNanos, truth.priceNanos);
    assert.equal(customer.priceNanos, truth.priceNanos);

    // Per feature, including the web search line.
    for (const feature of TOKEN_FEATURES) {
      const b = billing.byFeature.find((f) => f.feature === feature);
      const want = truth.byFeature[feature] ?? { events: 0, totalTokens: 0, priceNanos: 0 };
      assert.equal(b?.priceNanos ?? 0, want.priceNanos, `billing ${feature}`);
      assert.equal(b?.events ?? 0, want.events, `billing ${feature} events`);
    }
    if (range === 'period') {
      // Only this org is in the period with web search; Analytics byFeature is global.
      const web = analytics.byFeature.find((f: any) => f.feature === 'web_search');
      assert.equal(web.priceNanos, 80_000_000);
      assert.equal(billing.byFeature.find((f) => f.feature === 'web_search')?.priceNanos, 80_000_000);
    }

    // Claude is never $0 on either screen.
    const sonnet = analytics.byModel.find((m: any) => m.model === 'claude-sonnet-5');
    assert.ok(sonnet.priceNanos > 0, 'Analytics prices Claude Sonnet');
    assert.ok(truth.byFeature.ask.priceNanos > 0);
    assert.equal(analytics.health.unpricedEvents, 0);
    // The pre-fix $0 Claude row is in the period and is re-priced, not shown as $0.
    assert.ok(analytics.health.repricedEvents >= 1);
    const legacy = billing.recent.find((r) => r.id === 'a2');
    assert.ok(legacy, 'legacy Claude row is in the window');
    assert.ok(Number((legacy as any).priceNanos) > 0, 'Billing prices the legacy Claude row');
  });
}

test('the 30-day window and the billing period are different windows', async () => {
  const period = await loadTokenUsageReport(client, ORG, 'period');
  const last30 = await loadTokenUsageReport(client, ORG, '30d');
  // The "39 calls vs 18 calls" gap in production: two windows, not two ledgers.
  assert.ok(last30.totals.events > period.totals.events);
  assert.notEqual(period.periodStart, last30.periodStart);
});
