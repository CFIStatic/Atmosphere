import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cacheTokensOf, extractUsage, tryExtractUsage } from './anthropic.js';

/**
 * These assertions guard revenue. Every case here is a way the provider's usage
 * payload can be shaped, and getting any of them wrong means charging a
 * customer the wrong amount.
 */
describe('extractUsage', () => {
  it('keeps the four token classes disjoint and does not double count', () => {
    // input_tokens excludes cached tokens, so the total is a plain sum.
    const usage = extractUsage({
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 200,
      cache_read_input_tokens: 400,
    });

    assert.equal(usage.inputTokens, 100);
    assert.equal(usage.outputTokens, 50);
    assert.equal(usage.cacheReadTokens, 400);
    assert.equal(usage.totalTokens, 750);
  });

  it('attributes cache writes to the 5-minute tier when no breakdown is given', () => {
    // 5 minutes is the default TTL; billing the 1h rate here would overcharge.
    const usage = extractUsage({
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 1000,
      cache_read_input_tokens: 0,
    });

    assert.equal(usage.cacheWrite5mTokens, 1000);
    assert.equal(usage.cacheWrite1hTokens, 0);
  });

  it('splits cache writes by TTL when the breakdown is present', () => {
    const usage = extractUsage({
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: 900,
      cache_read_input_tokens: 0,
      cache_creation: { ephemeral_5m_input_tokens: 400, ephemeral_1h_input_tokens: 500 },
    });

    assert.equal(usage.cacheWrite5mTokens, 400);
    assert.equal(usage.cacheWrite1hTokens, 500);
  });

  it('reconciles to the aggregate when the breakdown under-reports', () => {
    // A partial breakdown must not lose billable tokens; the shortfall goes to
    // the cheaper tier so we never overcharge on an ambiguous payload.
    const usage = extractUsage({
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 1000,
      cache_read_input_tokens: 0,
      cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 300 },
    });

    assert.equal(usage.cacheWrite5mTokens + usage.cacheWrite1hTokens, 1000);
    assert.equal(usage.cacheWrite1hTokens, 300);
    assert.equal(usage.cacheWrite5mTokens, 700);
  });

  it('never bills more than the aggregate when the breakdown over-reports', () => {
    const usage = extractUsage({
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 500,
      cache_read_input_tokens: 0,
      cache_creation: { ephemeral_5m_input_tokens: 400, ephemeral_1h_input_tokens: 400 },
    });

    assert.equal(usage.cacheWrite5mTokens + usage.cacheWrite1hTokens, 500);
  });

  it('treats absent counters as zero rather than NaN', () => {
    const usage = extractUsage({ input_tokens: 42, output_tokens: 7 });

    assert.equal(usage.cacheWrite5mTokens, 0);
    assert.equal(usage.cacheReadTokens, 0);
    assert.equal(usage.totalTokens, 49);
  });

  it('refuses to bill from a missing or unusable usage object', () => {
    // Guessing here would invent a charge out of nothing.
    assert.throws(() => extractUsage(null), /missing usage|no usage/i);
    assert.throws(() => extractUsage(undefined), /missing usage|no usage/i);
    assert.throws(() => extractUsage({ input_tokens: -5, output_tokens: 0 }), /invalid/i);
    assert.throws(() => extractUsage({ input_tokens: 'lots', output_tokens: 0 }), /invalid/i);
  });

  it('tryExtractUsage returns zeros instead of throwing', () => {
    const usage = tryExtractUsage(null);
    assert.equal(usage.totalTokens, 0);
    assert.equal(cacheTokensOf(usage), 0);
  });
});
