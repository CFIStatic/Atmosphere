import test from 'node:test';
import assert from 'node:assert/strict';
import { billableNanosFromCost } from '../src/metering/customerMarkup.js';
import { estimateCostUsd, recordAiCost, usageCostUsd } from '../src/verification/cost/tracker.js';
import { estimatedUsdToNanos } from '../src/metering/tokenUsage.js';

test('estimateCostUsd prices the named model from the official rate card', () => {
  const gemini = estimateCostUsd('google', 1_000_000, 1_000_000, 'gemini-3.5-flash-lite');
  const claude = estimateCostUsd('anthropic', 1_000_000, 1_000_000, 'claude-sonnet-4-6');
  assert.equal(gemini, 2.8); // $0.30 in + $2.50 out
  assert.equal(claude, 18); // $3 in + $15 out
  // No model → no guess (a family default would silently mis-price).
  assert.equal(estimateCostUsd('google', 1_000_000, 1_000_000), 0);
  assert.ok(estimatedUsdToNanos(gemini) > 0);
  assert.ok(estimatedUsdToNanos(0) === 0);
});

test('usageCostUsd prices provider-reported Gemini usage including cache reads', () => {
  const usd = usageCostUsd('gemini-3.5-flash-lite', {
    inputTokens: 1_000_000,
    outputTokens: 0,
    cacheReadTokens: 1_000_000,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    totalTokens: 2_000_000,
  });
  assert.equal(usd, 0.33); // $0.30 input + $0.03 cached
});

test('recordAiCost writes the actor and estimated spend onto both ledgers', async () => {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const rpcs: Array<{ name: string; params: Record<string, unknown> }> = [];
  const supabase = {
    from(table: string) {
      return {
        insert: async (row: Record<string, unknown>) => {
          inserts.push({ table, row });
          return { error: null };
        },
      };
    },
    rpc: async (name: string, params: Record<string, unknown>) => {
      rpcs.push({ name, params });
      return { data: { eventId: 'evt-1', duplicate: false }, error: null };
    },
  };

  await recordAiCost(supabase, {
    orgId: 'org-1',
    videoId: 'vid-1',
    jobId: 'job-1',
    analysisRunId: 'run-1',
    userId: 'user-jack',
    idempotencyKey: 'video_analysis:run-1:frame-1',
    provider: 'google',
    modelName: 'gemini-3.5-flash-lite',
    inputTokens: 8000,
    outputTokens: 1200,
    estimatedCostUsd: estimateCostUsd('google', 8000, 1200, 'gemini-3.5-flash-lite'),
  });

  const costRow = inserts.find((row) => row.table === 'verification_ai_costs');
  assert.equal(costRow?.row.user_id, 'user-jack');
  assert.ok(Number(costRow?.row.estimated_cost_usd) > 0);

  assert.equal(rpcs.length, 1);
  assert.equal(rpcs[0]?.name, 'record_token_usage');
  assert.equal(rpcs[0]?.params.p_user_id, 'user-jack');
  assert.equal(rpcs[0]?.params.p_feature, 'video_analysis');
  const costNanos = estimatedUsdToNanos(estimateCostUsd('google', 8000, 1200, 'gemini-3.5-flash-lite'));
  assert.equal(Number(rpcs[0]?.params.p_cost_nanos), costNanos);
  assert.equal(Number(rpcs[0]?.params.p_price_nanos), billableNanosFromCost(costNanos));
  assert.equal(Number(rpcs[0]?.params.p_price_nanos), costNanos * 10);
});

test('recordAiCost resolves a job owner when no userId is passed', async () => {
  const rpcs: Array<{ name: string; params: Record<string, unknown> }> = [];
  const supabase = {
    from(table: string) {
      if (table === 'verification_ai_costs') {
        return {
          insert: async () => ({ error: null }),
        };
      }
      const api = {
        select() {
          return api;
        },
        eq() {
          return api;
        },
        maybeSingle: async () => {
          if (table === 'crm_jobs') {
            return { data: { owner_id: 'job-owner', created_by: 'creator' }, error: null };
          }
          return { data: null, error: null };
        },
      };
      return api;
    },
    rpc: async (name: string, params: Record<string, unknown>) => {
      rpcs.push({ name, params });
      return { data: { eventId: 'evt-2', duplicate: false }, error: null };
    },
  };

  await recordAiCost(supabase, {
    orgId: 'org-1',
    videoId: 'vid-1',
    jobId: 'job-1',
    provider: 'google',
    modelName: 'gemini-3.6-flash',
    inputTokens: 4000,
    outputTokens: 200,
    estimatedCostUsd: 0.001,
  });

  assert.equal(rpcs[0]?.params.p_user_id, 'job-owner');
  assert.ok(Number(rpcs[0]?.params.p_price_nanos) > 0);
});
