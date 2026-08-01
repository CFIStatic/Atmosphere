import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeReward, dispositionFromEdit, editRatio, provisionalReward } from './reward.js';
import { contextKeys, posteriorLowerBound, posteriorMean, primaryContextKey, sizeBucketFor } from './policy.js';
import { getTaskSpec } from './taskTypes.js';
import { parseJsonLoose, verify } from './verifiers.js';

/**
 * Tests for the pure decision logic — reward shaping, posterior arithmetic,
 * context backoff and verification. No network, no database.
 *
 * These are the parts that must be right for the loop to improve rather than
 * drift, and they are exactly the parts whose bugs are invisible in production:
 * a mis-weighted reward does not throw, it just quietly teaches the router the
 * wrong lesson for a month. Run with `npm test`.
 */

const summarySpec = getTaskSpec('summarize_job_notes');
const estimateSpec = getTaskSpec('estimate_line_items');

describe('reward: quality gate', () => {
  it('does not pay the efficiency bonus for fast, cheap, wrong work', () => {
    // The failure mode the gate exists to prevent: an arm that is instant and
    // free but useless must not out-score a slower arm that is correct.
    const cheapAndWrong = computeReward({
      spec: summarySpec,
      verifierScore: 0,
      disposition: 'rejected',
      editRatio: null,
      costUsd: 0,
      latencyMs: 10,
    });
    const slowAndRight = computeReward({
      spec: summarySpec,
      verifierScore: 1,
      disposition: 'accepted',
      editRatio: null,
      costUsd: summarySpec.costBudgetUsd * 3,
      latencyMs: summarySpec.latencyBudgetMs * 3,
    });

    assert.ok(
      slowAndRight.reward > cheapAndWrong.reward,
      `correct-but-slow (${slowAndRight.reward}) must beat wrong-but-instant (${cheapAndWrong.reward})`,
    );
    // Cost/latency weights sum to 0.40 on this task; without the gate the wrong
    // answer would collect all of it.
    assert.ok(cheapAndWrong.reward < 0.05, `expected near-zero, got ${cheapAndWrong.reward}`);
  });

  it('scales the bonus smoothly rather than switching it off at a cliff', () => {
    // Quality 0.3 — below the 0.5 gate, so the efficiency bonus is throttled
    // proportionally (0.6×) rather than dropped outright. A hard cliff here
    // would make two nearly-identical runs score very differently.
    const marginal = computeReward({
      spec: summarySpec,
      verifierScore: 0.3,
      disposition: 'edited_major',
      editRatio: 0.7,
      costUsd: 0,
      latencyMs: 0,
    });
    assert.equal(Number(marginal.quality.toFixed(3)), 0.3);
    assert.ok(
      marginal.qualityGate > 0 && marginal.qualityGate < 1,
      `expected partial gating, got ${marginal.qualityGate}`,
    );
  });
});

describe('reward: human signal', () => {
  it('outweighs the verifier without erasing it', () => {
    const verifierLovesIt = computeReward({
      spec: summarySpec,
      verifierScore: 1,
      disposition: 'rejected',
      editRatio: null,
      costUsd: 0.001,
      latencyMs: 1000,
    });
    // 25% of quality is still the verifier's, so a rejection floors it low but
    // not to zero — objective evidence is not fully overridden by one reviewer.
    assert.ok(verifierLovesIt.quality > 0.2 && verifierLovesIt.quality < 0.3);
  });

  it('prefers a measured edit ratio over the coarse bucket', () => {
    const barelyTouched = computeReward({
      spec: summarySpec,
      verifierScore: 1,
      disposition: 'edited_minor',
      editRatio: 0.01,
      costUsd: 0,
      latencyMs: 0,
    });
    const bucketOnly = computeReward({
      spec: summarySpec,
      verifierScore: 1,
      disposition: 'edited_minor',
      editRatio: null,
      costUsd: 0,
      latencyMs: 0,
    });
    assert.ok(barelyTouched.quality > bucketOnly.quality);
  });

  it('stays inside [0,1] for every disposition', () => {
    for (const disposition of ['accepted', 'edited_minor', 'edited_major', 'rejected', 'failed'] as const) {
      const { reward } = computeReward({
        spec: estimateSpec,
        verifierScore: 0.5,
        disposition,
        editRatio: null,
        costUsd: 10,
        latencyMs: 600_000,
      });
      assert.ok(reward >= 0 && reward <= 1, `${disposition} produced ${reward}`);
    }
  });
});

describe('reward: provisional vs final', () => {
  it('applies the verifier at full weight when no human has spoken', () => {
    const provisional = provisionalReward({
      spec: summarySpec,
      verifierScore: 0.8,
      costUsd: 0.001,
      latencyMs: 500,
    });
    assert.equal(provisional.quality, 0.8);
  });
});

describe('editRatio', () => {
  it('is 0 for an untouched output and 1 for a full replacement', () => {
    assert.equal(editRatio('same text', 'same text'), 0);
    assert.equal(editRatio('abc', ''), 1);
  });

  it('grows with the size of the change', () => {
    const small = editRatio('the roof was inspected today', 'the roof was inspected Today');
    const large = editRatio('the roof was inspected today', 'completely different content here');
    assert.ok(small > 0 && small < 0.2, `small edit measured ${small}`);
    assert.ok(large > small);
  });

  it('buckets into dispositions at sensible boundaries', () => {
    assert.equal(dispositionFromEdit(0), 'accepted');
    assert.equal(dispositionFromEdit(0.1), 'edited_minor');
    assert.equal(dispositionFromEdit(0.6), 'edited_major');
  });
});

describe('policy: context hierarchy', () => {
  it('orders keys most-specific first so backoff walks outward', () => {
    const keys = contextKeys({
      taskType: 'draft_scope',
      orgId: 'o',
      userId: 'u',
      workType: 'mitigation',
      sizeBucket: 'large',
    });
    assert.deepEqual(keys, ['draft_scope:mitigation:large', 'draft_scope:mitigation', 'draft_scope']);
    assert.equal(primaryContextKey({ taskType: 'draft_scope', orgId: 'o', userId: 'u' }), 'draft_scope');
  });

  it('prefers complexity over size when both are present', () => {
    const keys = contextKeys({
      taskType: 'estimate_line_items',
      orgId: 'o',
      userId: 'u',
      workType: 'construction',
      sizeBucket: 'large',
      complexity: 'complex',
    });
    assert.deepEqual(keys, [
      'estimate_line_items:construction:complex',
      'estimate_line_items:construction',
      'estimate_line_items',
    ]);
  });

  it('degrades gracefully when workType is unknown', () => {
    const keys = contextKeys({ taskType: 'draft_scope', orgId: 'o', userId: 'u', sizeBucket: 'small' });
    assert.deepEqual(keys, ['draft_scope:small', 'draft_scope']);
  });

  it('buckets inputs by size', () => {
    assert.equal(sizeBucketFor({ a: 'x' }), 'small');
    assert.equal(sizeBucketFor({ a: 'x'.repeat(5_000) }), 'medium');
    assert.equal(sizeBucketFor({ a: 'x'.repeat(50_000) }), 'large');
  });
});

describe('policy: posteriors', () => {
  it('penalises a flattering mean built on few trials', () => {
    // 3/3 wins looks perfect but proves little; 60/75 is worse on average and
    // far better established. The promotion gate compares lower bounds, so the
    // established arm must win — this is what stops promotion on a lucky streak.
    const lucky = posteriorLowerBound(4, 1);
    const proven = posteriorLowerBound(61, 16);
    assert.ok(posteriorMean(4, 1) > posteriorMean(61, 16), 'precondition: lucky arm has the better mean');
    assert.ok(proven > lucky, `proven ${proven} should exceed lucky ${lucky}`);
  });

  it('tightens the interval as evidence accumulates', () => {
    const early = posteriorMean(8, 2) - posteriorLowerBound(8, 2);
    const late = posteriorMean(80, 20) - posteriorLowerBound(80, 20);
    assert.ok(late < early);
  });
});

describe('verifier', () => {
  it('extracts JSON from fences and surrounding prose', () => {
    assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
    assert.deepEqual(parseJsonLoose('Here you go: {"a":1} — hope that helps'), { a: 1 });
    assert.throws(() => parseJsonLoose('no json at all'));
  });

  it('marks unparseable output as fatal', () => {
    const { result } = verify(summarySpec, 'I am afraid I cannot do that', {});
    assert.equal(result.passed, false);
    assert.equal(result.score, 0);
  });

  it('fails an estimate whose arithmetic does not hold', () => {
    const input = { scope: 'demo', priceList: [{ code: 'A1', description: 'x', unitPrice: 10 }] };
    const output = JSON.stringify({
      lineItems: [{ code: 'A1', description: 'x', quantity: 2, unit: 'ea', unitPrice: 10, lineTotal: 99 }],
      needsPricing: [],
      subtotal: 99,
      confidence: 0.9,
      sourceRefs: [],
    });
    const { result } = verify(estimateSpec, output, input);
    assert.equal(result.passed, false, 'a line total that does not multiply out must be fatal');
    assert.ok(result.checks.some((c) => c.name === 'line_totals_multiply' && !c.passed));
  });

  it('catches an invented price that is not on the supplied list', () => {
    const input = { scope: 'demo', priceList: [{ code: 'A1', description: 'x', unitPrice: 10 }] };
    const output = JSON.stringify({
      lineItems: [{ code: 'A1', description: 'x', quantity: 2, unit: 'ea', unitPrice: 17.5, lineTotal: 35 }],
      needsPricing: [],
      subtotal: 35,
      confidence: 0.9,
      sourceRefs: [],
    });
    const { result } = verify(estimateSpec, output, input);
    assert.ok(result.checks.some((c) => c.name === 'prices_from_list' && !c.passed));
    assert.equal(result.passed, false);
  });

  it('passes a well-formed estimate', () => {
    const input = { scope: 'demo', priceList: [{ code: 'A1', description: 'x', unitPrice: 10 }] };
    const output = JSON.stringify({
      lineItems: [{ code: 'A1', description: 'x', quantity: 2, unit: 'ea', unitPrice: 10, lineTotal: 20 }],
      needsPricing: [],
      subtotal: 20,
      confidence: 0.9,
      sourceRefs: [],
    });
    const { result } = verify(estimateSpec, output, input);
    assert.equal(result.passed, true, JSON.stringify(result.checks));
    assert.equal(result.score, 1);
  });

  it('flags a confident moisture call made with no dry standard', () => {
    const spec = getTaskSpec('classify_moisture_reading');
    const output = JSON.stringify({
      classification: 'wet',
      recommendedAction: 'keep drying',
      openQuestions: [],
      confidence: 0.95,
      sourceRefs: [],
    });
    const { result } = verify(spec, output, { material: 'drywall', reading: 30, unit: '%' });
    assert.ok(result.checks.some((c) => c.name === 'flags_missing_standard' && !c.passed));
  });
});
