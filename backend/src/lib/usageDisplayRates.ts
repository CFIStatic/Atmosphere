import { ANALYSIS_UNIT_CENTS } from './stripeInvoices.js';
import { usageCustomerMarkup } from '../metering/customerMarkup.js';
import { modelPriceTable, ratesForModel } from '../metering/modelPriceTable.js';
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
 * Video analysis is billed from the official rate card for the configured
 * model × the usage markup; escalated reads likewise. Stripe
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

/**
 * Rates the billing code actually charges: the official rate card (the same
 * one every ledger row is priced from) for the configured video and
 * escalation models, × the usage markup. A model missing from the card
 * shows 0 here and is flagged as unpriced wherever it is metered.
 */
export function billedUsageRateInputs(
  env: NodeJS.ProcessEnv = process.env,
): UsageRateInputs {
  const markup = usageCustomerMarkup(env);
  const table = modelPriceTable();
  const video = ratesForModel(table, verificationConfig.primaryModel);
  const escalation = ratesForModel(table, verificationConfig.escalationModel);
  return {
    videoInputUsdPerMTok: (video?.inputPerMTok ?? 0) * markup,
    videoOutputUsdPerMTok: (video?.outputPerMTok ?? 0) * markup,
    escalationInputUsdPerMTok: (escalation?.inputPerMTok ?? 0) * markup,
    escalationOutputUsdPerMTok: (escalation?.outputPerMTok ?? 0) * markup,
    analysisUnitCents: ANALYSIS_UNIT_CENTS,
  };
}

/** Customer-facing line. The allowance is the product; per-token invoice rates are not. */
export function billedUsageRateClause(_env: NodeJS.ProcessEnv = process.env): string {
  return 'Each plan includes an AI usage allowance. Buy credits if you need more.';
}
