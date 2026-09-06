import test from 'node:test';
import assert from 'node:assert/strict';
import { billableNanosFromCost } from '../src/metering/customerMarkup.js';
import { estimateCostUsd, recordAiCost } from '../src/verification/cost/tracker.js';
import { estimatedUsdToNanos } from '../src/metering/tokenUsage.js';

test('estimateCostUsd uses the verification Gemini / Anthropic rate config', () => {
  const gemini = estimateCostUsd('google', 1_000_000, 1_000_000);
  const claude = estimateCostUsd('anthropic', 1_000_000, 1_000_000);
  assert.equal(gemini, 0.5);
  assert.equal(claude, 18);
  assert.ok(estimatedUsdToNanos(gemini) > 0);
  assert.ok(estimatedUsdToNanos(0) === 0);
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
    modelName: 'gemini-3.6-flash',
    inputTokens: 8000,
    outputTokens: 1200,
    estimatedCostUsd: estimateCostUsd('google', 8000, 1200),
  });

  const costRow = inserts.find((row) => row.table === 'verification_ai_costs');
  assert.equal(costRow?.row.user_id, 'user-jack');
  assert.ok(Number(costRow?.row.estimated_cost_usd) > 0);

  assert.equal(rpcs.length, 1);
  assert.equal(rpcs[0]?.name, 'record_token_usage');
  assert.equal(rpcs[0]?.params.p_user_id, 'user-jack');
  assert.equal(rpcs[0]?.params.p_feature, 'video_analysis');
  const costNanos = estimatedUsdToNanos(estimateCostUsd('google', 8000, 1200));
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
