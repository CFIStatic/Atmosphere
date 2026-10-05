import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_ANTHROPIC_MODEL,
  isRetiredAnthropicModelError,
  resolveAnthropicModel,
} from '../src/lib/anthropicModel.js';

test('retired Anthropic pins are upgraded even when Railway still overrides the default', () => {
  assert.equal(resolveAnthropicModel('claude-opus-4-1-20250805'), DEFAULT_ANTHROPIC_MODEL);
  assert.equal(resolveAnthropicModel('claude-opus-4-1'), DEFAULT_ANTHROPIC_MODEL);
  assert.equal(resolveAnthropicModel(undefined), DEFAULT_ANTHROPIC_MODEL);
});

test('superseded Anthropic pins upgrade to the current lineup', () => {
  assert.equal(resolveAnthropicModel('claude-sonnet-5'), 'claude-sonnet-5-5');
  assert.equal(resolveAnthropicModel('claude-opus-5'), 'claude-opus-5-5');
  assert.equal(resolveAnthropicModel('', 'claude-opus-4-8'), 'claude-opus-5-5');
});

test('ANTHROPIC_MODEL_PIN keeps an explicit prior pin', () => {
  const prev = process.env.ANTHROPIC_MODEL_PIN;
  process.env.ANTHROPIC_MODEL_PIN = '1';
  try {
    assert.equal(resolveAnthropicModel('claude-sonnet-5'), 'claude-sonnet-5');
  } finally {
    if (prev === undefined) delete process.env.ANTHROPIC_MODEL_PIN;
    else process.env.ANTHROPIC_MODEL_PIN = prev;
  }
});

test('only terminal failures caused by retired model pins are auto-recoverable', () => {
  assert.equal(isRetiredAnthropicModelError('404 model: claude-opus-4-1-20250805'), true);
  assert.equal(isRetiredAnthropicModelError('429 rate limit'), false);
});

test('dense clip dictation and day film use Anthropic streaming to stay under the 10-minute create limit', async () => {
  const dictation = await readFile(new URL('../src/shared/videoIntelligence.ts', import.meta.url), 'utf8');
  const dayFilm = await readFile(new URL('../src/shared/proofAnalyst.ts', import.meta.url), 'utf8');
  assert.match(dictation, /messages\.stream\(\{/);
  assert.match(dictation, /\}\)\.finalMessage\(\)/);
  assert.match(dayFilm, /messages\.stream\(\{/);
  assert.match(dayFilm, /\}\)\.finalMessage\(\)/);
});
