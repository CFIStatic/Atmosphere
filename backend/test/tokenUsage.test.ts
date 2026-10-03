import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTokenFeature } from '../src/metering/tokenFeatures.js';
import { billableNanosFromCost } from '../src/metering/customerMarkup.js';
import {
  aggregateJobTokenUsage,
  aggregateTokenUsage,
  collectPaged,
  eachUtcDay,
  estimatedUsdToNanos,
  eventBillableNanos,
  quoteMeasuredUsageCostNanos,
  recordMeasuredTokenUsageAsync,
  recordTokenUsage,
  resolveTokenUsageWindow,
  secondsToAnalysisMinutes,
  type TokenUsageEventRow,
} from '../src/metering/tokenUsage.js';

test('classifyTokenFeature buckets video analysis, chat, and ask', () => {
  assert.equal(classifyTokenFeature('video_analysis'), 'video_analysis');
  assert.equal(classifyTokenFeature('llm_verifier'), 'video_analysis');
  assert.equal(classifyTokenFeature('frame_analysis'), 'video_analysis');
  assert.equal(classifyTokenFeature('proof_ask'), 'ask');
  assert.equal(classifyTokenFeature('clip_ask'), 'ask');
  assert.equal(classifyTokenFeature('ask'), 'ask');
  assert.equal(classifyTokenFeature('field_assistant'), 'chat');
  assert.equal(classifyTokenFeature('model_completion'), 'chat');
  assert.equal(classifyTokenFeature('technician_assist'), 'chat');
  assert.equal(classifyTokenFeature('pm_brief'), 'other');
  assert.equal(classifyTokenFeature('financial_brief'), 'other');
  assert.equal(classifyTokenFeature(null), 'other');
});

test('classifyTokenFeature does not treat task as ask', () => {
  assert.equal(classifyTokenFeature('task'), 'other');
  assert.equal(classifyTokenFeature('create_task'), 'other');
});

test('resolveTokenUsageWindow uses the billing period when asked', () => {
  const window = resolveTokenUsageWindow({
    range: 'period',
    periodStart: '2026-08-01T00:00:00.000Z',
    periodEnd: '2026-09-01T00:00:00.000Z',
  });
  assert.equal(window.start, '2026-08-01T00:00:00.000Z');
  assert.equal(window.end, '2026-09-01T00:00:00.000Z');
});

test('resolveTokenUsageWindow falls back to a rolling window', () => {
  const now = new Date('2026-08-31T12:00:00.000Z');
  const thirty = resolveTokenUsageWindow({ range: '30d', now });
  assert.equal(thirty.end, now.toISOString());
  assert.equal(Date.parse(now.toISOString()) - Date.parse(thirty.start), 30 * 86_400_000);

  const ninety = resolveTokenUsageWindow({ range: '90d', now });
  assert.equal(Date.parse(now.toISOString()) - Date.parse(ninety.start), 90 * 86_400_000);
});

test('eachUtcDay fills empty calendar days', () => {
  assert.deepEqual(eachUtcDay('2026-08-01T08:00:00.000Z', '2026-08-03T12:00:00.000Z'), [
    '2026-08-01',
    '2026-08-02',
    '2026-08-03',
  ]);
});

function event(partial: Partial<TokenUsageEventRow> & Pick<TokenUsageEventRow, 'id' | 'feature' | 'createdAt'>): TokenUsageEventRow {
  return {
    orgId: 'org-1',
    userId: 'user-1',
    jobId: null,
    requestId: partial.id,
    source: partial.feature,
    modelId: 'claude',
    inputTokens: 100,
    outputTokens: 20,
    cacheTokens: 0,
    totalTokens: 120,
    costNanos: 100_000,
    priceNanos: 1_000_000,
    ...partial,
  };
}

test('aggregateTokenUsage totals the org, each feature, each employee, and each day', () => {
  const rows: TokenUsageEventRow[] = [
    event({
      id: 'e1',
      feature: 'video_analysis',
      userId: 'user-1',
      createdAt: '2026-08-02T10:00:00.000Z',
      inputTokens: 8000,
      outputTokens: 1200,
      cacheTokens: 0,
      totalTokens: 9200,
      priceNanos: 40_000_000,
    }),
    event({
      id: 'e2',
      feature: 'ask',
      userId: 'user-2',
      createdAt: '2026-08-02T15:00:00.000Z',
      inputTokens: 1500,
      outputTokens: 400,
      cacheTokens: 200,
      totalTokens: 2100,
      priceNanos: 8_000_000,
    }),
    event({
      id: 'e3',
      feature: 'chat',
      userId: 'user-1',
      createdAt: '2026-08-03T09:00:00.000Z',
      inputTokens: 600,
      outputTokens: 180,
      cacheTokens: 0,
      totalTokens: 780,
      priceNanos: 3_000_000,
    }),
  ];

  const report = aggregateTokenUsage(
    rows,
    { start: '2026-08-01T00:00:00.000Z', end: '2026-08-04T00:00:00.000Z' },
    [
      { userId: 'user-1', fullName: 'Elena Ortiz', email: 'elena@example.com', role: 'global_admin' },
      { userId: 'user-2', fullName: 'Marcus Chen', email: 'marcus@example.com', role: 'employee' },
    ],
  );

  assert.equal(report.totals.events, 3);
  assert.equal(report.totals.totalTokens, 9200 + 2100 + 780);
  assert.equal(report.totals.priceNanos, 51_000_000);

  const video = report.byFeature.find((row) => row.feature === 'video_analysis');
  const ask = report.byFeature.find((row) => row.feature === 'ask');
  const chat = report.byFeature.find((row) => row.feature === 'chat');
  assert.equal(video?.totalTokens, 9200);
  assert.equal(ask?.totalTokens, 2100);
  assert.equal(chat?.totalTokens, 780);

  assert.equal(report.byDay.length, 4);
  assert.equal(report.byDay[0]?.day, '2026-08-01');
  assert.equal(report.byDay[0]?.totalTokens, 0);
  assert.deepEqual(report.byDay[0]?.actors, []);
  assert.equal(report.byDay[1]?.totalTokens, 11300);
  assert.equal(report.byDay[1]?.byFeature.video_analysis.totalTokens, 9200);
  assert.equal(report.byDay[1]?.byFeature.ask.totalTokens, 2100);
  assert.equal(report.byDay[1]?.events, 2);
  assert.equal(report.byDay[1]?.priceNanos, 48_000_000);
  assert.deepEqual(
    report.byDay[1]?.actors.map((actor) => ({ name: actor.name, events: actor.events })),
    [
      { name: 'Elena Ortiz', events: 1 },
      { name: 'Marcus Chen', events: 1 },
    ],
  );
  assert.deepEqual(report.byDay[2]?.actors, [
    { userId: 'user-1', name: 'Elena Ortiz', events: 1 },
  ]);

  assert.equal(report.byEmployee[0]?.name, 'Elena Ortiz');
  assert.equal(report.byEmployee[0]?.totalTokens, 9980);
  assert.equal(report.byEmployee[0]?.roleLabel, 'Global Admin');
  assert.equal(report.byEmployee[1]?.name, 'Marcus Chen');
  assert.equal(report.byEmployee[1]?.totalTokens, 2100);
  assert.equal(report.byEmployee[1]?.roleLabel, 'Employee');

  assert.equal(report.recent[0]?.id, 'e3');
});

test('aggregateTokenUsage attributes video analysis to the job owner, not Unattributed', () => {
  const rows: TokenUsageEventRow[] = [
    event({
      id: 'video-1',
      feature: 'video_analysis',
      userId: 'user-jack',
      createdAt: '2026-09-01T10:00:00.000Z',
      inputTokens: 8000,
      outputTokens: 1200,
      totalTokens: 9200,
      priceNanos: estimatedUsdToNanos(0.00128),
    }),
    event({
      id: 'ask-1',
      feature: 'ask',
      userId: 'user-jack',
      createdAt: '2026-09-01T11:00:00.000Z',
      inputTokens: 400,
      outputTokens: 168,
      totalTokens: 568,
      priceNanos: 12_400_000,
    }),
  ];

  const report = aggregateTokenUsage(
    rows,
    { start: '2026-09-01T00:00:00.000Z', end: '2026-09-02T00:00:00.000Z' },
    [{ userId: 'user-jack', fullName: 'Jack Cyganiak', email: 'jack@jettx.ai', role: 'global_admin' }],
  );

  assert.equal(report.byEmployee.length, 1);
  assert.equal(report.byEmployee[0]?.name, 'Jack Cyganiak');
  assert.equal(report.byEmployee[0]?.byFeature.video_analysis.totalTokens, 9200);
  assert.equal(report.byEmployee[0]?.byFeature.ask.totalTokens, 568);
  assert.ok(report.byEmployee[0]!.priceNanos > 0);
  assert.equal(report.byEmployee.some((row) => row.userId === null), false);
});

test('aggregateTokenUsage keeps a System row only when no actor exists', () => {
  const rows: TokenUsageEventRow[] = [
    event({
      id: 'anon-1',
      feature: 'video_analysis',
      userId: null,
      createdAt: '2026-09-01T10:00:00.000Z',
      totalTokens: 100,
      priceNanos: 0,
    }),
  ];
  const report = aggregateTokenUsage(
    rows,
    { start: '2026-09-01T00:00:00.000Z', end: '2026-09-02T00:00:00.000Z' },
    [],
  );
  assert.equal(report.byEmployee[0]?.name, 'Unattributed');
  assert.equal(report.byEmployee[0]?.roleLabel, 'System');
  assert.equal(report.byEmployee[0]?.userId, null);
});

const askUsage = {
  inputTokens: 400,
  outputTokens: 168,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0,
  cacheReadTokens: 0,
  totalTokens: 568,
};

test('quoteMeasuredUsageCostNanos prices from the official rate card, not an RPC', async () => {
  let rpcCalls = 0;
  const cost = await quoteMeasuredUsageCostNanos(
    {
      rpc: async () => {
        rpcCalls += 1;
        return { data: { cost_nanos: '1', price_nanos: '1' }, error: null };
      },
    } as any,
    'claude-sonnet-4-6',
    askUsage,
  );
  // 400 × $3/M + 168 × $15/M
  assert.equal(cost, 400 * 3_000 + 168 * 15_000);
  assert.equal(rpcCalls, 0);
});

test('quoteMeasuredUsageCostNanos stays 0 when the model is unknown', async () => {
  const unknown = await quoteMeasuredUsageCostNanos(
    {
      rpc: async () => ({ data: null, error: { message: 'unknown_model' } }),
    } as any,
    'mystery-model',
    {
      inputTokens: 10,
      outputTokens: 4,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 14,
    },
  );
  assert.equal(unknown, 0);
});

test('recordTokenUsage writes provider cost and 10× billable', async () => {
  const rpcs: Array<{ name: string; params: Record<string, unknown> }> = [];
  const client = {
    rpc: async (name: string, params: Record<string, unknown>) => {
      rpcs.push({ name, params });
      return { data: { eventId: 'evt-ask', duplicate: false }, error: null };
    },
  } as any;

  await recordTokenUsage(client, {
    orgId: 'org-1',
    requestId: 'ask-1',
    feature: 'ask',
    costNanos: 9_200_000,
  });

  assert.equal(rpcs[0]?.name, 'record_token_usage');
  assert.equal(rpcs[0]?.params.p_cost_nanos, 9_200_000);
  assert.equal(rpcs[0]?.params.p_price_nanos, 92_000_000);
  assert.equal((rpcs[0]?.params.p_metadata as { customerMarkup?: number }).customerMarkup, 10);
});

test('recordMeasuredTokenUsageAsync stores rate-card cost and 10× billable for a Claude Ask turn', async () => {
  const rpcs: Array<{ name: string; params: Record<string, unknown> }> = [];
  const client = {
    rpc: async (name: string, params: Record<string, unknown>) => {
      rpcs.push({ name, params });
      return { data: { eventId: 'evt-ask', duplicate: false }, error: null };
    },
  } as any;

  await recordMeasuredTokenUsageAsync(client, {
    orgId: 'org-1',
    requestId: 'ask:job-1',
    feature: 'ask',
    source: 'proof_ask',
    modelId: 'claude-sonnet-4-6',
    usage: askUsage,
  });

  assert.equal(rpcs.some((row) => row.name === 'quote_usage'), false);
  const record = rpcs.find((row) => row.name === 'record_token_usage');
  const cost = 400 * 3_000 + 168 * 15_000;
  assert.equal(record?.params.p_cost_nanos, cost);
  assert.equal(record?.params.p_price_nanos, billableNanosFromCost(cost));
  assert.equal(record?.params.p_price_nanos, cost * 10);
  assert.equal(record?.params.p_feature, 'ask');
  assert.equal(record?.params.p_provider, 'anthropic');
  assert.equal(record?.params.p_pricing_status, 'priced');
});

test('aggregateTokenUsage Spend KPI is the billable price_nanos, not COGS', () => {
  const cost = estimatedUsdToNanos(0.00128);
  const billable = billableNanosFromCost(cost);
  const rows: TokenUsageEventRow[] = [
    event({
      id: 'video-billable',
      feature: 'video_analysis',
      createdAt: '2026-09-01T10:00:00.000Z',
      costNanos: cost,
      priceNanos: billable,
    }),
  ];
  const report = aggregateTokenUsage(
    rows,
    { start: '2026-09-01T00:00:00.000Z', end: '2026-09-02T00:00:00.000Z' },
    [{ userId: 'user-1', fullName: 'Elena Ortiz', email: 'elena@example.com', role: 'global_admin' }],
  );
  assert.equal(report.totals.priceNanos, billable);
  assert.equal(report.byEmployee[0]?.priceNanos, billable);
  assert.notEqual(report.totals.priceNanos, cost);
});

test('secondsToAnalysisMinutes converts film seconds honestly', () => {
  assert.equal(secondsToAnalysisMinutes(750), 12.5);
  assert.equal(secondsToAnalysisMinutes(60), 1);
  assert.equal(secondsToAnalysisMinutes(0), null);
  assert.equal(secondsToAnalysisMinutes(null), null);
});

test('aggregateJobTokenUsage rolls tokens and analysis minutes per job', () => {
  const rows: TokenUsageEventRow[] = [
    event({
      id: 'j1-a',
      feature: 'video_analysis',
      createdAt: '2026-09-01T10:00:00.000Z',
      jobId: 'job-a',
      totalTokens: 1000,
      inputTokens: 800,
      outputTokens: 200,
      priceNanos: 5_000_000,
    }),
    event({
      id: 'j1-b',
      feature: 'ask',
      createdAt: '2026-09-01T11:00:00.000Z',
      jobId: 'job-a',
      totalTokens: 200,
      inputTokens: 150,
      outputTokens: 50,
      priceNanos: 1_000_000,
    }),
    event({
      id: 'j2',
      feature: 'video_analysis',
      createdAt: '2026-09-01T12:00:00.000Z',
      jobId: 'job-b',
      totalTokens: 500,
      inputTokens: 400,
      outputTokens: 100,
      priceNanos: 2_000_000,
    }),
    event({
      id: 'none',
      feature: 'chat',
      createdAt: '2026-09-01T13:00:00.000Z',
      jobId: null,
      totalTokens: 50,
      priceNanos: 100_000,
    }),
  ];

  const byJob = aggregateJobTokenUsage(
    rows,
    [
      { jobId: 'job-a', title: 'Oak Street', jobNumber: 1042 },
      { jobId: 'job-b', title: 'Pine Ave', jobNumber: null },
    ],
    new Map([
      ['job-a', 750],
      // job-b has no timed film → minutes null
    ]),
  );

  assert.equal(byJob.length, 2);
  assert.equal(byJob[0]?.jobId, 'job-a'); // higher spend first
  assert.equal(byJob[0]?.title, 'Oak Street');
  assert.equal(byJob[0]?.jobNumber, 1042);
  assert.equal(byJob[0]?.analysisMinutes, 12.5);
  assert.equal(byJob[0]?.analysisSeconds, 750);
  assert.equal(byJob[0]?.totalTokens, 1200);
  assert.equal(byJob[0]?.priceNanos, 6_000_000);
  assert.equal(byJob[0]?.byFeature.video_analysis.totalTokens, 1000);
  assert.equal(byJob[0]?.byFeature.ask.totalTokens, 200);

  assert.equal(byJob[1]?.jobId, 'job-b');
  assert.equal(byJob[1]?.analysisMinutes, null);
  assert.equal(byJob[1]?.totalTokens, 500);
});

test('aggregateTokenUsage includes byJob when job context is provided', () => {
  const rows: TokenUsageEventRow[] = [
    event({
      id: 'with-job',
      feature: 'video_analysis',
      createdAt: '2026-09-01T10:00:00.000Z',
      jobId: 'job-z',
      totalTokens: 300,
      priceNanos: 900_000,
    }),
  ];
  const report = aggregateTokenUsage(
    rows,
    { start: '2026-09-01T00:00:00.000Z', end: '2026-09-02T00:00:00.000Z' },
    [],
    {
      jobs: [{ jobId: 'job-z', title: 'Zeta', jobNumber: 7 }],
      analysisSecondsByJob: new Map([['job-z', 120]]),
    },
  );
  assert.equal(report.byJob.length, 1);
  assert.equal(report.byJob[0]?.analysisMinutes, 2);
  assert.equal(report.byJob[0]?.title, 'Zeta');
});

test('resolveTokenUsageWindow caps an open billing period at now', () => {
  const now = new Date('2026-08-15T18:00:00.000Z');
  const window = resolveTokenUsageWindow({
    range: 'period',
    periodStart: '2026-08-01T00:00:00.000Z',
    periodEnd: '2026-09-01T00:00:00.000Z',
    now,
  });
  assert.equal(window.start, '2026-08-01T00:00:00.000Z');
  assert.equal(window.end, now.toISOString());
});

test('eventBillableNanos prices zero-dollar Gemini rows at official rates and leaves unknown models at zero', () => {
  const gemini = eventBillableNanos({
    modelId: 'gemini-3.5-flash-lite',
    inputTokens: 529,
    outputTokens: 39,
    cacheTokens: 0,
    costNanos: 0,
    priceNanos: 0,
  });
  // $0.30 / $2.50 per M → 300 / 2,500 nanos per token, ×10 markup
  assert.equal(gemini, (529 * 300 + 39 * 2_500) * 10);

  const unknown = eventBillableNanos({
    modelId: 'mystery-model',
    inputTokens: 529,
    outputTokens: 39,
    cacheTokens: 0,
    costNanos: 0,
    priceNanos: 0,
  });
  assert.equal(unknown, 0);

  const stored = eventBillableNanos({
    modelId: 'gemini-3.6-flash',
    inputTokens: 1,
    outputTokens: 1,
    cacheTokens: 0,
    costNanos: 100,
    priceNanos: 1_890_000,
  });
  assert.equal(stored, 1_890_000);
});

test('aggregateTokenUsage includes Gemini ask spend that was stored as zero', () => {
  const rows: TokenUsageEventRow[] = [
    event({
      id: 'ask-zero',
      feature: 'ask',
      modelId: 'gemini-3.6-flash',
      createdAt: '2026-09-04T13:04:30.000Z',
      inputTokens: 529,
      outputTokens: 39,
      cacheTokens: 0,
      totalTokens: 568,
      costNanos: 0,
      priceNanos: 0,
    }),
  ];
  const report = aggregateTokenUsage(
    rows,
    { start: '2026-09-01T00:00:00.000Z', end: '2026-09-05T00:00:00.000Z' },
    [{ userId: 'user-1', fullName: 'Elena Ortiz', email: 'elena@example.com', role: 'global_admin' }],
  );
  assert.equal(report.totals.events, 1);
  assert.equal(report.totals.totalTokens, 568);
  // gemini-3.6-flash in Sept 2026: $0.75 / $3.75 per M
  assert.equal(report.totals.priceNanos, (529 * 750 + 39 * 3_750) * 10);
  assert.equal(report.byFeature.find((row) => row.feature === 'ask')?.priceNanos, report.totals.priceNanos);
});

test('recordMeasuredTokenUsageAsync stores provider usage, cache split and 10× Gemini cost', async () => {
  const rpcs: Array<{ name: string; params: Record<string, unknown> }> = [];
  const client = {
    rpc: async (name: string, params: Record<string, unknown>) => {
      rpcs.push({ name, params });
      return { data: { eventId: 'evt-gem', duplicate: false }, error: null };
    },
  } as any;
  const raw = { promptTokenCount: 629, candidatesTokenCount: 39, cachedContentTokenCount: 100 };
  const usage = {
    inputTokens: 529,
    outputTokens: 39,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    cacheReadTokens: 100,
    totalTokens: 668,
    provider: 'google' as const,
    calls: [
      {
        provider: 'google' as const,
        model: 'gemini-3.5-flash-lite',
        inputTokens: 529,
        outputTokens: 39,
        cacheReadTokens: 100,
        cacheWrite5mTokens: 0,
        cacheWrite1hTokens: 0,
        raw,
      },
    ],
  };
  await recordMeasuredTokenUsageAsync(client, {
    orgId: 'org-1',
    requestId: 'ask:gem',
    feature: 'ask',
    modelId: 'gemini-3.5-flash-lite',
    usage,
  });
  const record = rpcs.find((row) => row.name === 'record_token_usage');
  const cogs = 529 * 300 + 39 * 2_500 + 100 * 30;
  assert.equal(record?.params.p_cost_nanos, cogs);
  assert.equal(record?.params.p_price_nanos, cogs * 10);
  assert.equal(record?.params.p_provider, 'google');
  assert.equal(record?.params.p_cache_read_tokens, 100);
  assert.equal(record?.params.p_cache_write_5m_tokens, 0);
  assert.deepEqual(record?.params.p_provider_usage, {
    calls: [{ provider: 'google', model: 'gemini-3.5-flash-lite', usage: raw }],
  });
});

test('collectPaged walks past a 1000-row PostgREST page', async () => {
  const calls: Array<[number, number]> = [];
  const rows = await collectPaged(3, async (from, to) => {
    calls.push([from, to]);
    if (from === 0) return [1, 2, 3];
    if (from === 3) return [4];
    return [];
  });
  assert.deepEqual(rows, [1, 2, 3, 4]);
  assert.deepEqual(calls, [[0, 2], [3, 5]]);
});
