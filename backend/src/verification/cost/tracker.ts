/**
 * AI cost estimation and monthly budget enforcement.
 */

import { randomUUID } from 'node:crypto';
import { verificationConfig } from '../config.js';
import { estimatedUsdToNanos, recordTokenUsage } from '../../metering/tokenUsage.js';
import { resolveUsageActor } from '../../metering/usageAttribution.js';

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
    userId?: string | null;
    idempotencyKey?: string;
    provider: string;
    modelName: string;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  },
): Promise<void> {
  const userId =
    opts.userId ??
    (await resolveUsageActor(supabase, {
      orgId: opts.orgId,
      videoId: opts.videoId,
      jobId: opts.jobId,
    }));

  await supabase.from('verification_ai_costs').insert({
    org_id: opts.orgId,
    video_id: opts.videoId ?? null,
    job_id: opts.jobId ?? null,
    analysis_run_id: opts.analysisRunId ?? null,
    user_id: userId,
    provider: opts.provider,
    model_name: opts.modelName,
    input_tokens: opts.inputTokens,
    output_tokens: opts.outputTokens,
    estimated_cost_usd: opts.estimatedCostUsd,
    period_month: monthStart(),
  });

  try {
    await recordTokenUsage(supabase, {
      orgId: opts.orgId,
      requestId: opts.idempotencyKey ?? `video_analysis:${opts.analysisRunId ?? randomUUID()}`,
      feature: 'video_analysis',
      source: 'video_analysis',
      userId,
      jobId: opts.jobId ?? null,
      modelId: opts.modelName,
      inputTokens: opts.inputTokens,
      outputTokens: opts.outputTokens,
      priceNanos: estimatedUsdToNanos(opts.estimatedCostUsd),
      metadata: {
        provider: opts.provider,
        videoId: opts.videoId ?? null,
        analysisRunId: opts.analysisRunId ?? null,
      },
    });
  } catch (err) {
    console.error('[metering] failed to record video analysis token usage', {
      orgId: opts.orgId,
      requestId: opts.idempotencyKey,
      err,
    });
  }
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
