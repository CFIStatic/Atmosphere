import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assessTask,
  complexityFromScore,
  rankArmForAssessment,
  sizeBucketFor,
  tierFit,
} from './assessor.js';
import type { Arm } from './types.js';

/**
 * Tests for the pre-execution complexity assessor — the piece that decides
 * whether work should land on a fast model or a frontier one before any token
 * is spent. Pure logic, no network.
 */

function arm(partial: Partial<Arm> & Pick<Arm, 'provider' | 'model'>): Arm {
  return {
    id: partial.id ?? `${partial.provider}:${partial.model}`,
    taskType: partial.taskType ?? 'draft_scope',
    provider: partial.provider,
    model: partial.model,
    promptVariant: partial.promptVariant ?? 'baseline',
    status: partial.status ?? 'candidate',
  };
}

describe('assessor: complexity buckets', () => {
  it('maps scores into simple / moderate / complex', () => {
    assert.equal(complexityFromScore(0.1), 'simple');
    assert.equal(complexityFromScore(0.39), 'simple');
    assert.equal(complexityFromScore(0.4), 'moderate');
    assert.equal(complexityFromScore(0.69), 'moderate');
    assert.equal(complexityFromScore(0.7), 'complex');
    assert.equal(complexityFromScore(0.95), 'complex');
  });

  it('treats a moisture reading as simple and prefers fast models', () => {
    const assessment = assessTask('classify_moisture_reading', {
      material: 'drywall',
      reading: 28,
      unit: '%',
    });
    assert.equal(assessment.complexity, 'simple');
    assert.equal(assessment.preferredTiers[0], 'fast');
    assert.ok(assessment.reasons.length > 0);
  });

  it('treats estimate line items as complex and prefers frontier models', () => {
    const assessment = assessTask('estimate_line_items', {
      scope: 'Rebuild kitchen after water loss',
      priceList: Array.from({ length: 80 }, (_, i) => ({
        code: `C${i}`,
        description: `item ${i}`,
        unitPrice: 10 + i,
      })),
      measurements: Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`m${i}`, i])),
    });
    assert.equal(assessment.complexity, 'complex');
    assert.equal(assessment.preferredTiers[0], 'frontier');
    assert.ok(assessment.reasons.some((r) => /price list|high-stakes|measurements/i.test(r)));
  });

  it('escalates a long document extraction toward complex', () => {
    const short = assessTask('extract_document_fields', {
      documentText: 'Claim number 123. Policy ABC.',
      fields: ['claimNumber', 'policy'],
    });
    const long = assessTask('extract_document_fields', {
      documentText: 'x'.repeat(60_000),
      fields: Array.from({ length: 25 }, (_, i) => `field${i}`),
    });
    assert.ok(long.score > short.score);
    assert.equal(long.complexity, 'complex');
    assert.equal(long.preferredTiers[0], 'frontier');
  });

  it('keeps a short note summary cheaper than a long thread', () => {
    const short = assessTask('summarize_job_notes', {
      notes: [{ author: 'a', at: '2026-01-01', body: 'Arrived on site.' }],
    });
    const long = assessTask('summarize_job_notes', {
      notes: Array.from({ length: 100 }, (_, i) => ({
        author: 'tech',
        at: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
        body: `Day ${i}: continued drying and recorded moisture.`,
      })),
    });
    assert.equal(short.complexity, 'simple');
    assert.ok(long.score > short.score);
    assert.ok(long.complexity === 'moderate' || long.complexity === 'complex');
  });

  it('buckets inputs by size', () => {
    assert.equal(sizeBucketFor({ a: 'x' }), 'small');
    assert.equal(sizeBucketFor({ a: 'x'.repeat(5_000) }), 'medium');
    assert.equal(sizeBucketFor({ a: 'x'.repeat(50_000) }), 'large');
  });
});

describe('assessor: tier matching', () => {
  it('scores frontier arms highest on complex work', () => {
    const assessment = assessTask('estimate_line_items', {
      scope: 'demo',
      priceList: [{ code: 'A1', description: 'x', unitPrice: 10 }],
    });
    assert.equal(assessment.complexity, 'complex');

    const opus = arm({ provider: 'anthropic', model: 'claude-opus-5' });
    const haiku = arm({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001' });
    assert.ok(tierFit(opus, assessment) > tierFit(haiku, assessment));
    assert.ok(
      rankArmForAssessment(opus, assessment, 'estimate_line_items') >
        rankArmForAssessment(haiku, assessment, 'estimate_line_items'),
    );
  });

  it('scores fast arms highest on simple work', () => {
    const assessment = assessTask('classify_moisture_reading', {
      material: 'drywall',
      reading: 12,
      unit: '%',
      dryStandard: 10,
    });
    assert.equal(assessment.complexity, 'simple');

    const flash = arm({ provider: 'google', model: 'gemini-2.5-flash' });
    const pro = arm({ provider: 'google', model: 'gemini-2.5-pro' });
    assert.ok(tierFit(flash, assessment) > tierFit(pro, assessment));
  });

  it('prefers Google for document extraction among frontier peers', () => {
    const assessment = assessTask('extract_document_fields', {
      documentText: 'x'.repeat(60_000),
      fields: Array.from({ length: 25 }, (_, i) => `f${i}`),
    });
    const gemini = arm({ provider: 'google', model: 'gemini-2.5-pro' });
    const gpt = arm({ provider: 'openai', model: 'gpt-5' });
    assert.ok(
      rankArmForAssessment(gemini, assessment, 'extract_document_fields') >
        rankArmForAssessment(gpt, assessment, 'extract_document_fields'),
    );
  });
});
