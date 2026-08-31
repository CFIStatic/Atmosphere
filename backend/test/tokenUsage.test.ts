import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTokenFeature } from '../src/metering/tokenFeatures.js';
import {
  aggregateTokenUsage,
  eachUtcDay,
  resolveTokenUsageWindow,
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
  assert.equal(report.byDay[1]?.totalTokens, 11300);
  assert.equal(report.byDay[1]?.byFeature.video_analysis.totalTokens, 9200);
  assert.equal(report.byDay[1]?.byFeature.ask.totalTokens, 2100);

  assert.equal(report.byEmployee[0]?.name, 'Elena Ortiz');
  assert.equal(report.byEmployee[0]?.totalTokens, 9980);
  assert.equal(report.byEmployee[0]?.roleLabel, 'Global Admin');
  assert.equal(report.byEmployee[1]?.name, 'Marcus Chen');
  assert.equal(report.byEmployee[1]?.totalTokens, 2100);
  assert.equal(report.byEmployee[1]?.roleLabel, 'Employee');

  assert.equal(report.recent[0]?.id, 'e3');
});
