/**
 * Async, non-blocking usage event recorder.
 * Fire-and-forget by default so AI workflows are not blocked on billing I/O.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AiUsageEventInput, AiUsageEventResult } from './types.js';

function toRpcParams(input: AiUsageEventInput) {
  return {
    p_org: input.orgId,
    p_idempotency_key: input.idempotencyKey,
    p_action_type: input.actionType,
    p_provider: input.provider ?? null,
    p_model: input.model ?? null,
    p_user_id: input.userId ?? null,
    p_job_id: input.jobId ?? null,
    p_workflow_id: input.workflowId ?? null,
    p_agent_run_id: input.agentRunId ?? null,
    p_agent_type: input.agentType ?? null,
    p_input_tokens: input.inputTokens ?? 0,
    p_output_tokens: input.outputTokens ?? 0,
    p_cached_input_tokens: input.cachedInputTokens ?? 0,
    p_reasoning_tokens: input.reasoningTokens ?? 0,
    p_image_count: input.imageCount ?? 0,
    p_video_seconds: input.videoSeconds ?? 0,
    p_audio_seconds: input.audioSeconds ?? 0,
    p_ocr_pages: input.ocrPages ?? 0,
    p_embedding_tokens: input.embeddingTokens ?? 0,
    p_third_party_cost_nanos: input.thirdPartyCostNanos ?? 0,
    p_other_variable_cost_nanos: input.otherVariableCostNanos ?? 0,
    p_billable: input.billable ?? true,
    p_metadata: input.metadata ?? {},
    p_at: input.at ?? null,
  };
}

function parseResult(raw: Record<string, unknown>): AiUsageEventResult {
  return {
    eventId: String(raw.eventId),
    duplicate: Boolean(raw.duplicate),
    estimatedProviderCostNanos: Number(raw.estimatedProviderCostNanos ?? 0),
    computeUnits: Number(raw.computeUnits ?? 0),
  };
}

/** Record one AI usage event (awaits completion). Idempotent on idempotencyKey. */
export async function recordAiUsageEvent(
  client: SupabaseClient,
  input: AiUsageEventInput,
): Promise<AiUsageEventResult> {
  const { data, error } = await client.rpc('record_ai_usage_event', toRpcParams(input));
  if (error) throw error;
  return parseResult(data as Record<string, unknown>);
}

/**
 * Queue usage recording without blocking the caller.
 * Errors are logged, never thrown to the workflow.
 */
export function recordAiUsageEventAsync(
  client: SupabaseClient,
  input: AiUsageEventInput,
  onError?: (err: unknown) => void,
): void {
  void recordAiUsageEvent(client, input).catch((err) => {
    console.error('[metering] failed to record usage event', {
      orgId: input.orgId,
      idempotencyKey: input.idempotencyKey,
      err,
    });
    onError?.(err);
  });
}
