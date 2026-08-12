/**
 * Verification capabilities / analyzer selection — no paid API calls.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getVerificationCapabilities,
  resolveLlmVerifierMode,
  resolveVisionAnalyzerMode,
} from '../../src/verification/capabilities.js';
import { createDefaultAnalyzer } from '../../src/verification/factory.js';
import { createDefaultVerifier } from '../../src/verification/ai/llmVerifier.js';
import {
  MockVisionAnalyzer,
  RoutedVisionAnalyzer,
  UnconfiguredVisionAnalyzer,
} from '../../src/verification/ai/analyzer.js';
import {
  MockVerificationProvider,
  RoutedVerificationProvider,
  UnconfiguredVerificationProvider,
} from '../../src/verification/ai/llmVerifier.js';
import { selectVideoRoute } from '../../src/verification/ai/router.js';

const ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  'XAI_API_KEY',
  'VERIFICATION_USE_MOCK_AI',
  'VERIFICATION_ALLOW_MOCK_FALLBACK',
  'VERIFICATION_PRIMARY_PROVIDER',
  'VERIFICATION_PRIMARY_MODEL',
  'VERIFICATION_ESCALATION_PROVIDER',
  'VERIFICATION_ESCALATION_MODEL',
  'VERIFICATION_LLM_VERIFIER_MODEL',
  'NODE_ENV',
] as const;

function withEnv(
  overrides: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>,
  fn: () => void,
) {
  const prior = new Map<string, string | undefined>();
  for (const key of ENV_KEYS) {
    prior.set(key, process.env[key]);
    const next = overrides[key];
    if (next === undefined) delete process.env[key];
    else process.env[key] = next;
  }
  try {
    fn();
  } finally {
    for (const key of ENV_KEYS) {
      const value = prior.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('vision routes through cheapest configured provider (Gemini preferred)', () => {
  withEnv(
    {
      GOOGLE_API_KEY: 'g-test',
      OPENAI_API_KEY: 'o-test',
      ANTHROPIC_API_KEY: 'a-test',
      XAI_API_KEY: 'x-test',
      VERIFICATION_USE_MOCK_AI: undefined,
      VERIFICATION_ALLOW_MOCK_FALLBACK: undefined,
      VERIFICATION_PRIMARY_PROVIDER: undefined,
      VERIFICATION_PRIMARY_MODEL: undefined,
      NODE_ENV: 'development',
    },
    () => {
      assert.equal(resolveVisionAnalyzerMode(), 'routed');
      assert.ok(createDefaultAnalyzer() instanceof RoutedVisionAnalyzer);
      const route = selectVideoRoute('frame_observation');
      assert.ok(route);
      assert.equal(route!.provider, 'google');
      assert.match(route!.catalogKey, /^google:/);
    },
  );
});

test('with only OpenAI, bulk frames route to openai:mini', () => {
  withEnv(
    {
      GOOGLE_API_KEY: undefined,
      GEMINI_API_KEY: undefined,
      ANTHROPIC_API_KEY: undefined,
      XAI_API_KEY: undefined,
      OPENAI_API_KEY: 'o-test',
      VERIFICATION_USE_MOCK_AI: undefined,
      VERIFICATION_ALLOW_MOCK_FALLBACK: undefined,
      VERIFICATION_PRIMARY_PROVIDER: undefined,
      VERIFICATION_PRIMARY_MODEL: undefined,
      NODE_ENV: 'development',
    },
    () => {
      const route = selectVideoRoute('frame_observation');
      assert.ok(route);
      assert.equal(route!.provider, 'openai');
      assert.equal(route!.tier, 'fast');
    },
  );
});

test('escalation prefers Anthropic balanced when available', () => {
  withEnv(
    {
      GOOGLE_API_KEY: 'g-test',
      ANTHROPIC_API_KEY: 'a-test',
      OPENAI_API_KEY: 'o-test',
      VERIFICATION_USE_MOCK_AI: undefined,
      VERIFICATION_ESCALATION_PROVIDER: undefined,
      VERIFICATION_ESCALATION_MODEL: undefined,
      NODE_ENV: 'development',
    },
    () => {
      const route = selectVideoRoute('frame_escalation');
      assert.ok(route);
      assert.equal(route!.provider, 'anthropic');
      assert.equal(route!.tier, 'balanced');
    },
  );
});

test('missing keys fail loudly instead of silent mock', () => {
  withEnv(
    {
      GOOGLE_API_KEY: undefined,
      GEMINI_API_KEY: undefined,
      ANTHROPIC_API_KEY: undefined,
      OPENAI_API_KEY: undefined,
      XAI_API_KEY: undefined,
      VERIFICATION_USE_MOCK_AI: undefined,
      VERIFICATION_ALLOW_MOCK_FALLBACK: undefined,
      NODE_ENV: 'development',
    },
    () => {
      assert.equal(resolveVisionAnalyzerMode(), 'unconfigured');
      assert.equal(resolveLlmVerifierMode(), 'unconfigured');
      assert.ok(createDefaultAnalyzer() instanceof UnconfiguredVisionAnalyzer);
      assert.ok(createDefaultVerifier() instanceof UnconfiguredVerificationProvider);
    },
  );
});

test('explicit mock flag still uses fixture analyzers', () => {
  withEnv(
    {
      VERIFICATION_USE_MOCK_AI: 'true',
      ANTHROPIC_API_KEY: undefined,
      GOOGLE_API_KEY: undefined,
      OPENAI_API_KEY: undefined,
      XAI_API_KEY: undefined,
      NODE_ENV: 'development',
    },
    () => {
      assert.equal(resolveVisionAnalyzerMode(), 'mock');
      assert.ok(createDefaultAnalyzer() instanceof MockVisionAnalyzer);
      assert.ok(createDefaultVerifier() instanceof MockVerificationProvider);
    },
  );
});

test('capabilities reports routing plan and never includes key values', () => {
  withEnv(
    {
      ANTHROPIC_API_KEY: 'sk-secret-must-not-leak',
      GOOGLE_API_KEY: 'google-secret-must-not-leak',
      OPENAI_API_KEY: 'openai-secret-must-not-leak',
      XAI_API_KEY: 'xai-secret-must-not-leak',
      VERIFICATION_USE_MOCK_AI: undefined,
      VERIFICATION_ALLOW_MOCK_FALLBACK: undefined,
      VERIFICATION_PRIMARY_PROVIDER: undefined,
      VERIFICATION_PRIMARY_MODEL: undefined,
      NODE_ENV: 'development',
    },
    () => {
      const caps = getVerificationCapabilities();
      const blob = JSON.stringify(caps);
      assert.equal(blob.includes('sk-secret-must-not-leak'), false);
      assert.equal(blob.includes('google-secret-must-not-leak'), false);
      assert.equal(blob.includes('openai-secret-must-not-leak'), false);
      assert.equal(blob.includes('xai-secret-must-not-leak'), false);
      assert.equal(caps.keys.anthropic, true);
      assert.equal(caps.keys.google, true);
      assert.equal(caps.keys.openai, true);
      assert.equal(caps.keys.xai, true);
      assert.equal(caps.visionAnalyzer.mode, 'routed');
      assert.equal(caps.llmVerifier.mode, 'routed');
      assert.ok(createDefaultVerifier() instanceof RoutedVerificationProvider);
      assert.ok(caps.routing.frameObservation);
      assert.equal(caps.routing.frameObservation!.provider, 'google');
      assert.ok(caps.requiredEnv.some((e) => e.name === 'OPENAI_API_KEY' && e.set));
      assert.ok(caps.requiredEnv.some((e) => e.name === 'XAI_API_KEY' && e.set));
    },
  );
});
