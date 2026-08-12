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
  AnthropicVisionAnalyzer,
  GeminiVisionAnalyzer,
  MockVisionAnalyzer,
  UnconfiguredVisionAnalyzer,
} from '../../src/verification/ai/analyzer.js';
import {
  MockVerificationProvider,
  UnconfiguredVerificationProvider,
} from '../../src/verification/ai/llmVerifier.js';

const ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'VERIFICATION_USE_MOCK_AI',
  'VERIFICATION_ALLOW_MOCK_FALLBACK',
  'NODE_ENV',
] as const;

function withEnv(overrides: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>, fn: () => void) {
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

test('vision prefers Gemini when Google key is set', () => {
  withEnv(
    {
      GOOGLE_API_KEY: 'g-test',
      ANTHROPIC_API_KEY: 'a-test',
      VERIFICATION_USE_MOCK_AI: undefined,
      VERIFICATION_ALLOW_MOCK_FALLBACK: undefined,
      NODE_ENV: 'development',
    },
    () => {
      assert.equal(resolveVisionAnalyzerMode(), 'gemini');
      assert.ok(createDefaultAnalyzer() instanceof GeminiVisionAnalyzer);
    },
  );
});

test('vision falls back to Anthropic when only Anthropic is set', () => {
  withEnv(
    {
      GOOGLE_API_KEY: undefined,
      GEMINI_API_KEY: undefined,
      ANTHROPIC_API_KEY: 'a-test',
      VERIFICATION_USE_MOCK_AI: undefined,
      VERIFICATION_ALLOW_MOCK_FALLBACK: undefined,
      NODE_ENV: 'development',
    },
    () => {
      assert.equal(resolveVisionAnalyzerMode(), 'anthropic');
      assert.ok(createDefaultAnalyzer() instanceof AnthropicVisionAnalyzer);
    },
  );
});

test('missing keys fail loudly instead of silent mock', () => {
  withEnv(
    {
      GOOGLE_API_KEY: undefined,
      GEMINI_API_KEY: undefined,
      ANTHROPIC_API_KEY: undefined,
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
      NODE_ENV: 'development',
    },
    () => {
      assert.equal(resolveVisionAnalyzerMode(), 'mock');
      assert.ok(createDefaultAnalyzer() instanceof MockVisionAnalyzer);
      assert.ok(createDefaultVerifier() instanceof MockVerificationProvider);
    },
  );
});

test('capabilities reports env names and never includes key values', () => {
  withEnv(
    {
      ANTHROPIC_API_KEY: 'sk-secret-must-not-leak',
      GOOGLE_API_KEY: 'google-secret-must-not-leak',
      VERIFICATION_USE_MOCK_AI: undefined,
      VERIFICATION_ALLOW_MOCK_FALLBACK: undefined,
      NODE_ENV: 'development',
    },
    () => {
      const caps = getVerificationCapabilities();
      const blob = JSON.stringify(caps);
      assert.equal(blob.includes('sk-secret-must-not-leak'), false);
      assert.equal(blob.includes('google-secret-must-not-leak'), false);
      assert.equal(caps.keys.anthropic, true);
      assert.equal(caps.keys.google, true);
      assert.equal(caps.visionAnalyzer.mode, 'gemini');
      assert.equal(caps.llmVerifier.mode, 'anthropic');
      assert.ok(caps.requiredEnv.some((e) => e.name === 'ANTHROPIC_API_KEY' && e.set));
    },
  );
});
