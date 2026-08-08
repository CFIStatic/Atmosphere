/**
 * Pure cost engine — estimates provider cost and Compute Units from pricing config.
 * No hard-coded provider prices; callers supply rows from ai_model_pricing.
 */

import type { AiModelPricingRow, UsageDimensions } from './types.js';

export const NANOS_PER_USD = 1_000_000_000;
export const MTok = 1_000_000;

/** Convert USD to nanodollars (integer). */
export function usdToNanos(usd: number): number {
  return Math.round(usd * NANOS_PER_USD);
}

/** Convert nanodollars to USD. */
export function nanosToUsd(nanos: number): number {
  return nanos / NANOS_PER_USD;
}

/**
 * Estimate variable provider cost in nanodollars from a pricing row and usage dims.
 * Returns 0 when no pricing row is supplied (caller should treat as unknown).
 */
export function estimateProviderCostNanos(
  pricing: AiModelPricingRow | null | undefined,
  dims: UsageDimensions,
): number {
  let usd = 0;

  if (pricing) {
    usd += (dims.inputTokens * pricing.inputTokenPriceUsd) / MTok;
    usd += (dims.outputTokens * pricing.outputTokenPriceUsd) / MTok;

    const cachedRate =
      pricing.cachedInputTokenPriceUsd ??
      pricing.inputTokenPriceUsd * 0.1;
    usd += (dims.cachedInputTokens * cachedRate) / MTok;
    usd += (dims.reasoningTokens * pricing.outputTokenPriceUsd) / MTok;

    if (pricing.imagePriceUsd) usd += dims.imageCount * pricing.imagePriceUsd;
    if (pricing.videoSecondPriceUsd) usd += dims.videoSeconds * pricing.videoSecondPriceUsd;
    if (pricing.audioSecondPriceUsd) usd += dims.audioSeconds * pricing.audioSecondPriceUsd;
    if (pricing.ocrPagePriceUsd) usd += dims.ocrPages * pricing.ocrPagePriceUsd;
    if (pricing.embeddingTokenPriceUsd) {
      usd += (dims.embeddingTokens * pricing.embeddingTokenPriceUsd) / MTok;
    }
  }

  return usdToNanos(usd) + dims.thirdPartyCostNanos + dims.otherVariableCostNanos;
}

/**
 * Convert estimated provider cost to Atmosphere Compute Units.
 * Rate is configurable (e.g. 0.01 USD per CU) and stored on each event.
 */
export function costToComputeUnits(costNanos: number, usdPerComputeUnit: number): number {
  if (usdPerComputeUnit <= 0) return 0;
  const usd = nanosToUsd(costNanos);
  return Math.round((usd / usdPerComputeUnit) * 1_000_000) / 1_000_000;
}

export interface PeriodChargeInput {
  baseMonthlyFeeCents: number;
  processedJobs: number;
  includedJobs: number;
  additionalJobPriceCents: number;
  computeUnitsConsumed: number;
  includedComputeUnits: number;
  computeUnitOverageNanos: number;
  videoSeconds: number;
  videoHourPriceCents: number | null;
  estimatedAiCostNanos: number;
}

export interface PeriodChargeResult {
  excessJobs: number;
  jobOverageChargeCents: number;
  excessComputeUnits: number;
  computeOverageChargeCents: number;
  videoProcessingChargeCents: number;
  estimatedCustomerChargeCents: number;
  estimatedGrossProfitCents: number;
  estimatedGrossMarginPct: number | null;
}

/**
 * Deterministic customer charge + margin from period usage and plan terms.
 * Mirrors public.calculate_metering_period logic for unit tests.
 */
export function calculatePeriodCharges(input: PeriodChargeInput): PeriodChargeResult {
  const excessJobs = Math.max(input.processedJobs - input.includedJobs, 0);
  const jobOverageChargeCents = excessJobs * input.additionalJobPriceCents;

  const excessComputeUnits = Math.max(input.computeUnitsConsumed - input.includedComputeUnits, 0);
  const computeOverageChargeNanos = Math.round(excessComputeUnits * input.computeUnitOverageNanos);
  const computeOverageChargeCents = Math.round(computeOverageChargeNanos / 10_000_000);

  let videoProcessingChargeCents = 0;
  if (input.videoHourPriceCents != null && input.videoHourPriceCents > 0) {
    videoProcessingChargeCents = Math.round(
      (input.videoSeconds / 3600) * input.videoHourPriceCents,
    );
  }

  const estimatedCustomerChargeCents =
    input.baseMonthlyFeeCents +
    jobOverageChargeCents +
    computeOverageChargeCents +
    videoProcessingChargeCents;

  const revenueNanos = usdToNanos(estimatedCustomerChargeCents / 100);
  const grossProfitNanos = revenueNanos - input.estimatedAiCostNanos;
  const estimatedGrossProfitCents = Math.round(grossProfitNanos / 10_000_000);

  let estimatedGrossMarginPct: number | null = null;
  if (estimatedCustomerChargeCents > 0) {
    estimatedGrossMarginPct =
      Math.round((grossProfitNanos / revenueNanos) * 10_000) / 100;
  }

  return {
    excessJobs,
    jobOverageChargeCents,
    excessComputeUnits,
    computeOverageChargeCents,
    videoProcessingChargeCents,
    estimatedCustomerChargeCents,
    estimatedGrossProfitCents,
    estimatedGrossMarginPct,
  };
}
