import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Tracing and metering for the Financial Agent.
 *
 * Writes to the shared `agent_runs` / `agent_run_steps` ledger and meters
 * through `public.record_usage`. Best-effort: a missing ledger is a degraded
 * feature, not a broken run.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const FINANCIAL_AGENT_KEY = 'financial_agent';
export const FINANCIAL_AGENT_LABEL = 'Financial Agent';

const ABSENT_CODES = new Set(['42P01', '42883', 'PGRST202', 'PGRST205']);

function isAbsent(error: { code?: string } | null): boolean {
  return Boolean(error?.code && ABSENT_CODES.has(error.code));
}

export interface RunHandle {
  id: string | null;
  seq: number;
}

export interface StartRunInput {
  orgId: string;
  title: string;
  actorType?: 'user' | 'system' | 'schedule' | 'agent';
  actorUserId?: string | null;
  actorLabel?: string | null;
  sourceTable?: string | null;
  sourceId?: string | null;
  input?: Record<string, unknown>;
}

export async function startRun(
  supabase: SupabaseClient,
  input: StartRunInput,
): Promise<RunHandle> {
  try {
    const { data, error } = await supabase
      .from('agent_runs')
      .insert({
        org_id: input.orgId,
        agent_key: FINANCIAL_AGENT_KEY,
        agent_label: FINANCIAL_AGENT_LABEL,
        actor_type: input.actorType ?? 'user',
        actor_user_id: input.actorUserId ?? null,
        actor_label: input.actorLabel ?? null,
        title: input.title,
        status: 'running',
        input: input.input ?? {},
        source_table: input.sourceTable ?? null,
        source_id: input.sourceId ?? null,
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      if (!isAbsent(error)) console.warn('[finance] could not open agent run:', error.message);
      return { id: null, seq: 0 };
    }
    return { id: data.id as string, seq: 0 };
  } catch (err) {
    console.warn('[finance] could not open agent run:', (err as Error).message);
    return { id: null, seq: 0 };
  }
}

export type StepType =
  | 'status'
  | 'thought'
  | 'message'
  | 'tool_call'
  | 'tool_result'
  | 'observation'
  | 'navigation'
  | 'decision'
  | 'artifact'
  | 'usage'
  | 'error'
  | 'event';

export interface StepInput {
  type: StepType;
  action?: string;
  detail?: string;
  target?: string;
  payload?: Record<string, unknown>;
  status?: 'ok' | 'error' | 'pending';
  durationMs?: number;
}

export async function step(
  supabase: SupabaseClient,
  run: RunHandle,
  input: StepInput,
): Promise<void> {
  if (!run.id) return;
  run.seq += 1;
  try {
    const { error } = await supabase.from('agent_run_steps').insert({
      run_id: run.id,
      type: input.type,
      action: input.action ?? null,
      detail: input.detail ? input.detail.slice(0, 8000) : null,
      target: input.target ? input.target.slice(0, 2000) : null,
      payload: input.payload ?? null,
      status: input.status ?? 'ok',
      duration_ms: input.durationMs ?? null,
    });
    if (error && !isAbsent(error)) {
      console.warn('[finance] could not write agent step:', error.message);
    }
  } catch (err) {
    console.warn('[finance] could not write agent step:', (err as Error).message);
  }
}

export interface FinishRunInput {
  status: 'succeeded' | 'failed' | 'cancelled';
  summary?: string;
  result?: Record<string, unknown>;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  startedAt?: number;
}

export async function finishRun(
  supabase: SupabaseClient,
  run: RunHandle,
  input: FinishRunInput,
): Promise<void> {
  if (!run.id) return;
  try {
    const finishedAt = new Date();
    const { error } = await supabase
      .from('agent_runs')
      .update({
        status: input.status,
        summary: input.summary ? input.summary.slice(0, 4000) : null,
        result: input.result ?? null,
        error: input.error ?? null,
        input_tokens: input.inputTokens ?? 0,
        output_tokens: input.outputTokens ?? 0,
        finished_at: finishedAt.toISOString(),
        duration_ms: input.startedAt ? Math.max(0, Date.now() - input.startedAt) : null,
      })
      .eq('id', run.id);
    if (error && !isAbsent(error)) {
      console.warn('[finance] could not close agent run:', error.message);
    }
  } catch (err) {
    console.warn('[finance] could not close agent run:', (err as Error).message);
  }
}

export interface UsageInput {
  orgId: string;
  modelId: string;
  requestId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWrite5mTokens?: number;
  cacheWrite1hTokens?: number;
  feature: string;
}

export async function recordUsage(
  supabase: SupabaseClient,
  usage: UsageInput,
): Promise<void> {
  try {
    const { error } = await supabase.rpc('record_usage', {
      p_org: usage.orgId,
      p_model_id: usage.modelId,
      p_request_id: usage.requestId,
      p_input_tokens: usage.inputTokens,
      p_output_tokens: usage.outputTokens,
      p_cache_write_5m_tokens: usage.cacheWrite5mTokens ?? 0,
      p_cache_write_1h_tokens: usage.cacheWrite1hTokens ?? 0,
      p_cache_read_tokens: usage.cacheReadTokens ?? 0,
      p_is_batch: false,
      p_feature: usage.feature,
    });
    if (error && !isAbsent(error)) {
      console.warn('[finance] could not record usage:', error.message);
    }
  } catch (err) {
    console.warn('[finance] could not record usage:', (err as Error).message);
  }
}
