/**
 * Cheap routing: simple/lookup (fast) prefers Gemini Flash when a Google key
 * is present; money/safety/dispute/date stay on deep / escalate.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { askFastGeminiModel } from '../src/lib/askModel.js';
import {
  fastAnswerNeedsDeepFallback,
  needsCriticalEscalation,
  routeAskQuestion,
} from '../src/shared/askRoute.js';
import { providerLookupStep } from '../src/shared/askReasoning.js';

test('simple inventory stays fast; money safety dispute date stay deep', () => {
  assert.equal(routeAskQuestion({ question: 'how many videos are on this job?' }).route, 'fast');
  assert.equal(routeAskQuestion({ question: 'what is the job address?' }).route, 'fast');
  assert.equal(needsCriticalEscalation('what is the deductible amount?'), true);
  assert.equal(needsCriticalEscalation('any safety hazards filmed?'), true);
  assert.equal(routeAskQuestion({ question: 'what is the claim amount owed?' }).route, 'deep');
  assert.equal(
    fastAnswerNeedsDeepFallback('what is the price?', 'Looks like two thousand.', true),
    true,
  );
});

test('fast Gemini model defaults to gemini-3.8-flash family', () => {
  const prev = process.env.ASK_FAST_MODEL;
  delete process.env.ASK_FAST_MODEL;
  try {
    assert.match(askFastGeminiModel(), /gemini-3\.[568]-flash/);
  } finally {
    if (prev === undefined) delete process.env.ASK_FAST_MODEL;
    else process.env.ASK_FAST_MODEL = prev;
  }
});

test('fast lookup prefers Gemini when both Anthropic and Google keys are set', async () => {
  const prev = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    google: process.env.GOOGLE_API_KEY,
  };
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  process.env.GEMINI_API_KEY = 'gemini-test';
  delete process.env.GOOGLE_API_KEY;

  const hosts: string[] = [];
  const fetchFn: typeof fetch = async (input) => {
    const url = String(input);
    hosts.push(url);
    if (url.includes('generativelanguage.googleapis.com')) {
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'There is 1 video.' }] } }],
          modelVersion: 'gemini-3.8-flash',
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response('unexpected anthropic call', { status: 500 });
  };

  try {
    const step = providerLookupStep({
      route: 'fast',
      anthropicApiKey: 'sk-ant-test',
      fetchFn,
    });
    const turn = await step({
      system: 'sys',
      stable: '',
      user: 'how many videos?',
      trace: [],
    });
    assert.ok(turn, 'expected a Gemini turn');
    assert.equal(turn.model.includes('gemini') || turn.text.includes('1 video'), true);
    assert.ok(
      hosts.some((h) => h.includes('generativelanguage.googleapis.com')),
      `expected Gemini host, got ${hosts.join(',')}`,
    );
    assert.ok(!hosts.some((h) => h.includes('api.anthropic.com')), 'must not call Anthropic first on fast');
  } finally {
    if (prev.anthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prev.anthropic;
    if (prev.gemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prev.gemini;
    if (prev.google === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = prev.google;
  }
});
