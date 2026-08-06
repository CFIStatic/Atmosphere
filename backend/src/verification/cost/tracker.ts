/**
 * AI cost estimation and monthly budget enforcement.
 */

import { verificationConfig } from '../config.js';

export function estimateCostUsd(
  provider: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = provider.toLowerCase();
  const inRate =
    p.includes('anthropic') || p.includes('claude')
      ? verificationConfig.anthropicInputPerMTokUsd
      : verificationConfig.geminiInputPerMTokUsd;
  const outRate =
    p.includes('anthropic') || p.includes('claude')
      ? verificationConfig.anthropicOutputPerMTokUsd
      : verificationConfig.geminiOutputPerMTokUsd;
  return Number(((inputTokens / 1e6) * inRate + (outputTokens / 1e6) * outRate).toFixed(6));
}

function monthStart(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export async function recordAiCost(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  opts: {
    orgId: string;
    videoId?: string | null;
    jobId?: string | null;
    analysisRunId?: string | null;
    provider: string;
    modelName: string;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  },
): Promise<void> {
  await supabase.from('verification_ai_costs').insert({
    org_id: opts.orgId,
    video_id: opts.videoId ?? null,
    job_id: opts.jobId ?? null,
    analysis_run_id: opts.analysisRunId ?? null,
    provider: opts.provider,
    model_name: opts.modelName,
    input_tokens: opts.inputTokens,
    output_tokens: opts.outputTokens,
    estimated_cost_usd: opts.estimatedCostUsd,
    period_month: monthStart(),
  });
}

export async function monthSpendUsd(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  orgId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('verification_ai_costs')
    .select('estimated_cost_usd')
    .eq('org_id', orgId)
    .eq('period_month', monthStart());
  if (error) throw new Error(error.message);
  return (data ?? []).reduce(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sum: number, row: any) => sum + Number(row.estimated_cost_usd ?? 0),
    0,
  );
}

export async function wouldExceedBudget(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  orgId: string,
  additionalUsd = 0,
): Promise<boolean> {
  const { data: limits } = await supabase
    .from('verification_usage_limits')
    .select('monthly_budget_usd')
    .eq('org_id', orgId)
    .maybeSingle();
  const budget =
    limits?.monthly_budget_usd != null
      ? Number(limits.monthly_budget_usd)
      : verificationConfig.defaultMonthlyBudgetUsd;
  if (budget <= 0) return false;
  const spent = await monthSpendUsd(supabase, orgId);
  return spent + additionalUsd > budget;
}
