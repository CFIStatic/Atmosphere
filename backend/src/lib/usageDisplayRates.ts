import { ANALYSIS_UNIT_CENTS } from './stripeInvoices.js';
import { usageCustomerMarkup } from '../metering/customerMarkup.js';
import { verificationConfig } from '../verification/config.js';

export interface UsageRateInputs {
  videoInputUsdPerMTok: number;
  videoOutputUsdPerMTok: number;
  escalationInputUsdPerMTok: number;
  escalationOutputUsdPerMTok: number;
  analysisUnitCents: number;
}

function usd(amount: number): string {
  return amount.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Customer-facing usage clause.
 *
 * Video analysis is billed from verificationConfig Gemini COGS × the usage
 * markup. Escalated reads use the Anthropic COGS × the same markup. Stripe
 * invoices that charge as analysis units at ANALYSIS_UNIT_CENTS.
 */
export function usageRateClause(input: UsageRateInputs): string {
  return (
    `Video analysis is ${usd(input.videoInputUsdPerMTok)} per million input tokens and ` +
    `${usd(input.videoOutputUsdPerMTok)} per million output tokens; escalated reads are ` +
    `${usd(input.escalationInputUsdPerMTok)} per million input tokens and ` +
    `${usd(input.escalationOutputUsdPerMTok)} per million output tokens. ` +
    `Invoices itemize that usage as analysis units at ${usd(input.analysisUnitCents / 100)} each.`
  );
}

/** Rates the billing code actually charges, including env overrides. */
export function billedUsageRateInputs(
  env: NodeJS.ProcessEnv = process.env,
): UsageRateInputs {
  const markup = usageCustomerMarkup(env);
  return {
    videoInputUsdPerMTok: verificationConfig.geminiInputPerMTokUsd * markup,
    videoOutputUsdPerMTok: verificationConfig.geminiOutputPerMTokUsd * markup,
    escalationInputUsdPerMTok: verificationConfig.anthropicInputPerMTokUsd * markup,
    escalationOutputUsdPerMTok: verificationConfig.anthropicOutputPerMTokUsd * markup,
    analysisUnitCents: ANALYSIS_UNIT_CENTS,
  };
}

/** Customer-facing line. The allowance is the product; per-token invoice rates are not. */
export function billedUsageRateClause(_env: NodeJS.ProcessEnv = process.env): string {
  return 'Each plan includes an AI usage allowance. Buy credits if you need more.';
}
