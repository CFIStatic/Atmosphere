/**
 * Atmosphere metering — shared types for usage events, plans, and period summaries.
 * Customer-facing shapes deliberately omit tokens, models, and internal margin.
 */

export interface AiUsageEventInput {
  orgId: string;
  idempotencyKey: string;
  actionType: string;
  provider?: string | null;
  model?: string | null;
  userId?: string | null;
  jobId?: string | null;
  workflowId?: string | null;
  agentRunId?: string | null;
  agentType?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  imageCount?: number;
  videoSeconds?: number;
  audioSeconds?: number;
  ocrPages?: number;
  embeddingTokens?: number;
  thirdPartyCostNanos?: number;
  otherVariableCostNanos?: number;
  billable?: boolean;
  metadata?: Record<string, unknown>;
  at?: string;
}

export interface AiUsageEventResult {
  eventId: string;
  duplicate: boolean;
  estimatedProviderCostNanos: number;
  computeUnits: number;
}

export interface RegisterBillableJobInput {
  orgId: string;
  jobId: string;
  workflowType: string;
  idempotencyKey: string;
  at?: string;
}

export interface RegisterBillableJobResult {
  jobId: string;
  duplicate: boolean;
  periodStart: string;
}

export interface MeteringPlanTerms {
  planCode: string;
  planName: string;
  planVersion: number;
  planVersionId: string;
  baseMonthlyFeeCents: number;
  includedJobs: number;
  additionalJobPriceCents: number;
  includedComputeUnits: number;
  computeUnitOverageNanos: number;
  videoHourPriceCents: number | null;
  billingPeriodDays: number;
  periodAnchorDay: number;
  hardStopAtLimit: boolean;
  usageLimitJobs: number | null;
  usageLimitComputeUnits: number | null;
  alertThresholdPct: number;
  marginAlertPct: number | null;
}

export interface MeteringPeriodCalculation {
  periodStart: string;
  periodEnd: string;
  terms: MeteringPlanTerms;
  processedJobs: number;
  includedJobs: number;
  excessJobs: number;
  jobOverageChargeCents: number;
  computeUnitsConsumed: number;
  includedComputeUnits: number;
  excessComputeUnits: number;
  computeOverageChargeCents: number;
  videoVerificationHours: number;
  videoProcessingChargeCents: number;
  basePlatformChargeCents: number;
  estimatedAiCostCents: number;
  estimatedGrossProfitCents: number;
  estimatedGrossMarginPct: number | null;
  estimatedCustomerChargeCents: number;
}

/** Customer-safe summary — no tokens, models, or margin. */
export interface CustomerMeteringSummary {
  periodStart: string;
  periodEnd: string;
  planName: string;
  processedJobs: number;
  includedJobs: number;
  excessJobs: number;
  videoVerificationHours: number;
  computeOverage: { units: number; chargeCents: number } | null;
  basePlatformChargeCents: number;
  jobOverageChargeCents: number;
  videoProcessingChargeCents: number;
  estimatedUpcomingBillCents: number;
}

export interface AiModelPricingRow {
  provider: string;
  model: string;
  inputTokenPriceUsd: number;
  outputTokenPriceUsd: number;
  cachedInputTokenPriceUsd?: number | null;
  imagePriceUsd?: number | null;
  videoSecondPriceUsd?: number | null;
  audioSecondPriceUsd?: number | null;
  ocrPagePriceUsd?: number | null;
  embeddingTokenPriceUsd?: number | null;
}

export interface UsageDimensions {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  imageCount: number;
  videoSeconds: number;
  audioSeconds: number;
  ocrPages: number;
  embeddingTokens: number;
  thirdPartyCostNanos: number;
  otherVariableCostNanos: number;
}

export const EMPTY_USAGE_DIMENSIONS: UsageDimensions = {
  inputTokens: 0,
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
