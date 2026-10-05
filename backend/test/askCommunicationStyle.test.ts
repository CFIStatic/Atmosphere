import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStylePromptSummary,
  mergeCommunicationStyle,
  observeCommunicationStyle,
  stylePromptAddendum,
  STYLE_PROMPT_MIN_CONFIDENCE,
  decayConfidence,
} from '../src/shared/askCommunicationStyle.js';

test('terse messages raise brevity; detail asks lower it', () => {
  const terse = observeCommunicationStyle({ question: 'status?' });
  assert.ok((terse.traits.brevity?.value ?? 0) >= 0.7);
  const detailed = observeCommunicationStyle({
    question: 'Please walk me through the full detail of what happened on the roof, with quotes and timestamps.',
  });
  assert.ok((detailed.traits.brevity?.value ?? 1) <= 0.35);
});

test('trade vocabulary and decision style are detected', () => {
  const obs = observeCommunicationStyle({
    question: 'Just tell me — should we file the claim supplement with the adjuster for the shingle ridge?',
  });
  assert.ok(obs.traits.tradeVocab?.roofing);
  assert.ok(obs.traits.tradeVocab?.insurance);
  assert.ok((obs.traits.decisionStyle?.value ?? 0) >= 0.65);
});

test('frustration rises on short corrections and rephrases', () => {
  const obs = observeCommunicationStyle({
    question: 'No, I said the kitchen.',
    previousQuestion: 'What happened in the bathroom?',
  });
  assert.ok(obs.frustrationBump >= 0.55);
});

test('merge decays old confidence and builds a prompt-safe summary', () => {
  let traits = mergeCommunicationStyle({}, { question: 'ok' });
  for (const question of [
    'bottom line — go or no-go on the tarp?',
    'just tell me the status',
    'tl;dr on the roof?',
    'yes or no — are we done?',
  ]) {
    traits = mergeCommunicationStyle(traits, { question, at: new Date().toISOString() });
  }
  assert.ok((traits.brevity?.confidence ?? 0) >= 0.25);
  const summary = buildStylePromptSummary(traits);
  assert.match(summary, /brief|bottom-line|direct|Prefer/i);
  assert.doesNotMatch(summary, /health|religion|politics|ethnicity|sexuality|disorder/i);
  const addendum = stylePromptAddendum(summary);
  assert.match(addendum, /never overrides quote grounding/i);
  assert.match(addendum, /Never mention this note/i);
});

test('low-confidence traits stay out of the prompt summary', () => {
  const summary = buildStylePromptSummary({
    brevity: { value: 0.9, confidence: STYLE_PROMPT_MIN_CONFIDENCE - 0.1, updatedAt: new Date().toISOString() },
  });
  assert.equal(summary, '');
});

test('decayConfidence halves over the half-life', () => {
  const half = decayConfidence(0.8, 45);
  assert.ok(Math.abs(half - 0.4) < 0.05);
});

test('forbidden trait keys never survive sanitize/merge', () => {
  const merged = mergeCommunicationStyle(
    { health: { value: 1, confidence: 1, updatedAt: new Date().toISOString() }, religion: 'x' },
    { question: 'status?' },
  );
  assert.equal((merged as Record<string, unknown>).health, undefined);
  assert.equal((merged as Record<string, unknown>).religion, undefined);
  const summary = buildStylePromptSummary(merged);
  assert.doesNotMatch(summary, /health|religion/i);
});
