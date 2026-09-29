/**
 * Default customer usage rates. Must match billedUsageRateClause() when
 * USAGE_CUSTOMER_MARKUP and the VERIFICATION_*_USD_PER_MTOK env vars are unset:
 * Gemini COGS $0.10 / $0.40 and Anthropic COGS $3 / $15, times the default
 * 10× usage markup, invoiced as analysis units at $0.01 (ANALYSIS_UNIT_CENTS).
 */

export interface UsageRateInputs {
  videoInputUsdPerMTok: number;
  videoOutputUsdPerMTok: number;
  escalationInputUsdPerMTok: number;
  escalationOutputUsdPerMTok: number;
  analysisUnitCents: number;
}

export const DEFAULT_USAGE_RATE_INPUTS: UsageRateInputs = {
  videoInputUsdPerMTok: 1,
  videoOutputUsdPerMTok: 4,
  escalationInputUsdPerMTok: 30,
  escalationOutputUsdPerMTok: 150,
  analysisUnitCents: 1,
};

function usd(amount: number): string {
  return amount.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function usageRateClause(input: UsageRateInputs = DEFAULT_USAGE_RATE_INPUTS): string {
  return (
    `Video analysis is ${usd(input.videoInputUsdPerMTok)} per million input tokens and ` +
    `${usd(input.videoOutputUsdPerMTok)} per million output tokens; escalated reads are ` +
    `${usd(input.escalationInputUsdPerMTok)} per million input tokens and ` +
    `${usd(input.escalationOutputUsdPerMTok)} per million output tokens. ` +
    `Invoices itemize that usage as analysis units at ${usd(input.analysisUnitCents / 100)} each.`
  );
}
