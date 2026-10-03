/**
 * Billed-but-unusable model replies on the video paths are metered.
 *
 * Gemini and Anthropic bill a reply when they return it. These paths used to
 * parse first and record usage after, so a reply that failed validation (e.g.
 * confidence 85 where the schema wants 0–1, seen in production) was paid for
 * but never reached the org's ledger. All providers here are mocked.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { GeminiVisionAnalyzer } from '../src/verification/ai/analyzer.js';
import { HttpLlmVerificationProvider, type WorkEventVerificationInput } from '../src/verification/ai/llmVerifier.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BilledReplyError, billedCallsOf } from '../src/verification/ai/billedReply.js';
import { dictatePreparedFrames } from '../src/shared/videoIntelligence.js';
import { runWithAiUsageScope } from '../src/metering/aiUsageContext.js';

const UNUSABLE = JSON.stringify({ room_type: 'hallway', confidence: 85 });

function geminiReply(text: string) {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 1341, candidatesTokenCount: 190, totalTokenCount: 1531 },
      responseId: 'gem-1',
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

test('verification frame analysis: an unusable Gemini reply carries its billed usage', async () => {
  const analyzer = new GeminiVisionAnalyzer({
    apiKey: 'k',
    baseUrl: 'http://mock.local',
    fetchFn: (async () => geminiReply(UNUSABLE)) as typeof fetch,
  });
  const err = await analyzer
    .analyzeFrame({ mimeType: 'image/jpeg', base64: Buffer.from('jpeg').toString('base64') })
    .then(() => null, (e: unknown) => e);
  assert.ok(err instanceof BilledReplyError, 'parse failure must carry the billed call');
  const [billed] = billedCallsOf(err);
  assert.equal(billed.reason, 'unusable_reply');
  assert.equal(billed.provider, 'google');
  assert.equal(billed.usage.inputTokens, 1341);
  assert.ok(billed.usage.outputTokens >= 190);
  assert.ok(billed.estimatedCostUsd >= 0);
});

test('LLM verifier (Gemini): an unusable reply carries its billed usage', async () => {
  const verifier = new HttpLlmVerificationProvider({
    provider: 'google',
    model: 'gemini-3.6-flash',
    apiKey: 'k',
    baseUrl: 'http://mock.local',
    fetchFn: (async () => geminiReply(UNUSABLE)) as typeof fetch,
  });
  const err = await verifier
    .verifyWorkEvent({ proposedActivity: 'drywall', beforeState: 'a', afterState: 'b', beforeFrameIds: [], afterFrameIds: [] } as unknown as WorkEventVerificationInput)
    .then(() => null, (e: unknown) => e);
  const billed = billedCallsOf(err);
  assert.equal(billed.length, 1);
  assert.equal(billed[0].usage.inputTokens, 1341);
  assert.equal(billed[0].modelName, 'gemini-3.6-flash');
});

test('LLM verifier (Anthropic): an unusable reply carries its billed usage', async () => {
  const verifier = new HttpLlmVerificationProvider({
    provider: 'anthropic',
    model: 'claude-opus-5',
    apiKey: 'k',
    fetchFn: (async () =>
      new Response(
        JSON.stringify({
          id: 'msg_1',
          model: 'claude-opus-5',
          content: [{ type: 'text', text: 'not json' }],
          usage: { input_tokens: 900, output_tokens: 120 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch,
  });
  const err = await verifier
    .verifyWorkEvent({ proposedActivity: 'drywall', beforeState: 'a', afterState: 'b', beforeFrameIds: [], afterFrameIds: [] } as unknown as WorkEventVerificationInput)
    .then(() => null, (e: unknown) => e);
  const billed = billedCallsOf(err);
  assert.equal(billed.length, 1);
  assert.equal(billed[0].usage.inputTokens, 900);
  assert.equal(billed[0].usage.outputTokens, 120);
});

test('video dictation is metered at the call, also when the reply is unusable', async () => {
  const savedFetch = globalThis.fetch;
  const savedEnv = { g: process.env.GOOGLE_API_KEY, a: process.env.ANTHROPIC_API_KEY, gb: process.env.GOOGLE_BASE_URL };
  process.env.GOOGLE_API_KEY = 'k';
  delete process.env.ANTHROPIC_API_KEY;
  process.env.GOOGLE_BASE_URL = 'http://mock.local';
  const rpcs: Array<{ fn: string; params: Record<string, unknown> }> = [];
  const client = {
    rpc: async (fn: string, params: Record<string, unknown>) => {
      rpcs.push({ fn, params });
      return { data: { eventId: `e${rpcs.length}`, duplicate: false }, error: null };
    },
    // Any query chain resolves to "no rows" (allowance settlement reads).
    from: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = new Proxy(() => chain, {
        get: (_t, prop) =>
          prop === 'then'
            ? (resolve: (v: unknown) => void) => resolve({ data: null, error: null })
            : () => chain,
      });
      return chain;
    },
  };
  try {
    globalThis.fetch = (async () => geminiReply('')) as typeof fetch;
    const prepared = {
      id: 'p1',
      source: 'proof_of_work' as const,
      durationSeconds: 10,
      longForm: false,
      frames: [0, 2, 4, 6].map((s) => ({ atSeconds: s, jpeg: Buffer.from('jpeg') })),
    };
    await assert.rejects(
      runWithAiUsageScope(
        { client: client as unknown as SupabaseClient, orgId: 'org-1', requestId: 'r1', meterFeature: 'video_analysis' },
        () => dictatePreparedFrames(prepared),
      ),
    );
    await new Promise((r) => setTimeout(r, 50));
    const ledger = rpcs.filter((r) => r.fn === 'record_token_usage');
    assert.equal(ledger.length, 1, 'the billed empty reply is recorded once');
    assert.equal(ledger[0].params.p_feature, 'video_analysis');
    assert.equal(ledger[0].params.p_source, 'video_dictation');
    assert.equal(ledger[0].params.p_input_tokens, 1341);
  } finally {
    globalThis.fetch = savedFetch;
    for (const [k, v] of [['GOOGLE_API_KEY', savedEnv.g], ['ANTHROPIC_API_KEY', savedEnv.a], ['GOOGLE_BASE_URL', savedEnv.gb]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
