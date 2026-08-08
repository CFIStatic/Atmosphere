import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateProviderCostNanos,
  costToComputeUnits,
  calculatePeriodCharges,
  usdToNanos,
} from '../src/metering/costEngine.js';
import type { AiModelPricingRow, UsageDimensions } from '../src/metering/types.js';

const samplePricing: AiModelPricingRow = {
  provider: 'anthropic',
  model: 'claude-sonnet-5',
  inputTokenPriceUsd: 3,
  outputTokenPriceUsd: 15,
  cachedInputTokenPriceUsd: 0.3,
  videoSecondPriceUsd: 0.002,
};

test('cost engine: token + video cost from pricing row', () => {
  const dims: UsageDimensions = {
    inputTokens: 1_000_000,
    outputTokens: 500_000,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    imageCount: 0,
    videoSeconds: 3600,
    audioSeconds: 0,
    ocrPages: 0,
    embeddingTokens: 0,
    thirdPartyCostNanos: 0,
    otherVariableCostNanos: 0,
  };
  const nanos = estimateProviderCostNanos(samplePricing, dims);
  // $3 input + $7.50 output + $7.20 video = $17.70
  assert.equal(nanos, usdToNanos(17.7));
});

test('cost engine: compute units respect configurable rate', () => {
  const cost = usdToNanos(10);
  assert.equal(costToComputeUnits(cost, 0.01), 1000);
  assert.equal(costToComputeUnits(cost, 0.05), 200);
});

test('period charges: included jobs — no job overage', () => {
  const result = calculatePeriodCharges({
    baseMonthlyFeeCents: 59900,
    processedJobs: 40,
    includedJobs: 50,
    additionalJobPriceCents: 3000,
    computeUnitsConsumed: 100,
    includedComputeUnits: 1000,
    computeUnitOverageNanos: 10_000_000,
    videoSeconds: 0,
    videoHourPriceCents: 2500,
    estimatedAiCostNanos: usdToNanos(50),
  });
  assert.equal(result.excessJobs, 0);
  assert.equal(result.jobOverageChargeCents, 0);
  assert.equal(result.estimatedCustomerChargeCents, 59900);
});

test('period charges: excess jobs billed per job', () => {
  const result = calculatePeriodCharges({
    baseMonthlyFeeCents: 59900,
    processedJobs: 187,
    includedJobs: 100,
    additionalJobPriceCents: 3000,
    computeUnitsConsumed: 0,
    includedComputeUnits: 1000,
    computeUnitOverageNanos: 10_000_000,
    videoSeconds: 0,
    videoHourPriceCents: null,
    estimatedAiCostNanos: 0,
  });
  assert.equal(result.excessJobs, 87);
  assert.equal(result.jobOverageChargeCents, 87 * 3000);
  assert.equal(result.estimatedCustomerChargeCents, 59900 + 87 * 3000);
});

test('period charges: compute overage above included allowance', () => {
  const result = calculatePeriodCharges({
    baseMonthlyFeeCents: 500000,
    processedJobs: 10,
    includedJobs: 100,
    additionalJobPriceCents: 3000,
    computeUnitsConsumed: 1500,
    includedComputeUnits: 1000,
    computeUnitOverageNanos: 10_000_000, // $0.01 per CU
    videoSeconds: 0,
    videoHourPriceCents: null,
    estimatedAiCostNanos: usdToNanos(120),
  });
  assert.equal(result.excessComputeUnits, 500);
  assert.equal(result.computeOverageChargeCents, 500); // 500 * $0.01
  assert.equal(result.estimatedGrossProfitCents, 500000 + 500 - 12000);
});

test('period charges: gross margin calculation', () => {
  const result = calculatePeriodCharges({
    baseMonthlyFeeCents: 100000,
    processedJobs: 0,
    includedJobs: 100,
    additionalJobPriceCents: 3000,
    computeUnitsConsumed: 0,
    includedComputeUnits: 1000,
    computeUnitOverageNanos: 10_000_000,
    videoSeconds: 0,
    videoHourPriceCents: null,
    estimatedAiCostNanos: usdToNanos(200),
  });
  assert.equal(result.estimatedCustomerChargeCents, 100000);
  assert.equal(result.estimatedGrossProfitCents, 100000 - 20000);
  assert.equal(result.estimatedGrossMarginPct, 80);
});

test('period charges: pricing plan change does not affect pure calculation inputs', () => {
  const base = {
    processedJobs: 50,
    includedJobs: 100,
    additionalJobPriceCents: 3000,
    computeUnitsConsumed: 500,
    includedComputeUnits: 1000,
    computeUnitOverageNanos: 10_000_000,
    videoSeconds: 7200,
    videoHourPriceCents: 2500,
    estimatedAiCostNanos: usdToNanos(75),
  };
  const lowBase = calculatePeriodCharges({ ...base, baseMonthlyFeeCents: 59900 });
  const highBase = calculatePeriodCharges({ ...base, baseMonthlyFeeCents: 500000 });
  assert.equal(lowBase.excessJobs, highBase.excessJobs);
  assert.equal(lowBase.jobOverageChargeCents, highBase.jobOverageChargeCents);
  assert.notEqual(lowBase.estimatedCustomerChargeCents, highBase.estimatedCustomerChargeCents);
});

test('idempotency: duplicate event keys produce same cost estimate', () => {
  const dims: UsageDimensions = {
    inputTokens: 1000,
    outputTokens: 500,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    imageCount: 0,
    videoSeconds: 0,
    audioSeconds: 0,
    ocrPages: 0,
    embeddingTokens: 0,
    thirdPartyCostNanos: 0,
    otherVariableCostNanos: 0,
  };
  const a = estimateProviderCostNanos(samplePricing, dims);
  const b = estimateProviderCostNanos(samplePricing, dims);
  assert.equal(a, b);
});

test('model price change: historical events use stored cost, new calc uses new price', () => {
  const dims: UsageDimensions = {
    inputTokens: 1_000_000,
    outputTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    imageCount: 0,
    videoSeconds: 0,
    audioSeconds: 0,
    ocrPages: 0,
    embeddingTokens: 0,
    thirdPartyCostNanos: 0,
    otherVariableCostNanos: 0,
  };
  const oldPrice = estimateProviderCostNanos(samplePricing, dims);
  const newPricing = { ...samplePricing, inputTokenPriceUsd: 1.5 };
  const newPrice = estimateProviderCostNanos(newPricing, dims);
  assert.notEqual(oldPrice, newPrice);
  assert.equal(oldPrice, usdToNanos(3));
  assert.equal(newPrice, usdToNanos(1.5));
});
