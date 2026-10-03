/**
 * Metering for AI calls made by background video work.
 *
 * Day readings, narration, long-form analysis, live frame checks, safety
 * frame checks, conversation summaries and speaker plans all call a model
 * without an org id of their own. Their entry points run inside an AI usage
 * scope with `meterFeature: 'video_analysis'` (`withVideoUsageScope`), and
 * each provider call reports its provider-measured usage here.
 *
 * - Scope with meterFeature → one ledger row per provider call.
 * - Scope without meterFeature (an Ask turn) → nothing: the turn records its
 *   own accumulated usage once, so a call is never counted twice.
 * - No scope → nothing can be attributed; when `alertWhenUnscoped` is set an
 *   ALERT is logged so the provider-billing reconciliation can explain it.
 *
 * tokenUsage.js is loaded lazily so the provider helpers that call this do
 * not pull the billing stack (Stripe, Supabase admin) in at import time.
 */

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { tryExtractUsage, type MeasuredUsage } from '../lib/anthropic.js';
import { currentAiUsageScope, runWithAiUsageScope } from './aiUsageContext.js';

export const VIDEO_ANALYSIS_FEATURE = 'video_analysis';

export function meterBackgroundUsage(input: {
  source: string;
  modelId: string | null | undefined;
  usage: MeasuredUsage | null | undefined;
  alertWhenUnscoped?: boolean;
}): void {
  const usage = input.usage;
  if (!usage || !(usage.totalTokens > 0)) return;
  const scope = currentAiUsageScope();
  if (!scope) {
    if (input.alertWhenUnscoped) {
      console.error('[metering] ALERT AI call with no org scope; provider usage not attributed', {
        source: input.source,
        modelId: input.modelId ?? null,
        totalTokens: usage.totalTokens,
      });
    }
    return;
  }
  if (!scope.meterFeature) return;
  const row = {
    orgId: scope.orgId,
    requestId: `${input.source}:${scope.requestId}:${randomUUID()}`,
    feature: scope.meterFeature,
    source: input.source,
    modelId: input.modelId ?? null,
    usage,
    jobId: scope.jobId ?? null,
    userId: scope.userId ?? null,
  };
  void import('./tokenUsage.js')
    .then(({ recordMeasuredTokenUsage }) => recordMeasuredTokenUsage(scope.client, row))
    .catch((err) => {
      console.error('[metering] failed to record background AI usage', {
        orgId: row.orgId,
        requestId: row.requestId,
        err,
      });
    });
}

/** Meter one Anthropic Messages response (provider-reported `usage`) in the current scope. */
export function meterAnthropicResponse(
  source: string,
  response: { usage?: unknown; model?: string | null } | null | undefined,
): void {
  if (!response) return;
  meterBackgroundUsage({
    source,
    modelId: response.model ?? null,
    usage: tryExtractUsage(response.usage, response.model ?? null),
    alertWhenUnscoped: true,
  });
}

/**
 * Run background video work for one proof inside a metering scope, so every
 * model call it makes is recorded on the proof's org as video analysis.
 * Looks the org up from the proof when the caller does not have it.
 */
export async function withVideoUsageScope<T>(
  client: SupabaseClient,
  ref: { proofId: string; orgId?: string | null; jobId?: string | null; userId?: string | null },
  fn: () => Promise<T>,
): Promise<T> {
  const current = currentAiUsageScope();
  if (current?.meterFeature && (!ref.orgId || current.orgId === ref.orgId)) return fn();
  let orgId = ref.orgId ?? null;
  let jobId = ref.jobId ?? null;
  if (!orgId) {
    try {
      const { data } = await client
        .from('job_proofs')
        .select('org_id, job_id')
        .eq('id', ref.proofId)
        .maybeSingle();
      orgId = (data?.org_id as string | undefined) ?? null;
      jobId = jobId ?? ((data?.job_id as string | undefined) ?? null);
    } catch {
      orgId = null;
    }
  }
  if (!orgId) return fn();
  return runWithAiUsageScope(
    {
      client,
      orgId,
      jobId,
      userId: ref.userId ?? null,
      requestId: `video:${ref.proofId}:${randomUUID()}`,
      meterFeature: VIDEO_ANALYSIS_FEATURE,
    },
    fn,
  );
}
