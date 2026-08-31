import type { SupabaseClient } from '@supabase/supabase-js';
import { recordTokenUsageAsync } from '../metering/tokenUsage.js';

/**
 * Tracing and metering for the Project Manager Agent.
 *
 * Atmosphere already has a generic agent audit ledger — `agent_runs` +
 * `agent_run_steps` — and a token meter, `public.record_usage`, which prices
 * against the rate card and debits credits. This module writes to both rather
 * than inventing a `pm_agent_runs` table, because a second audit trail is a
 * forked audit trail and the billing story would fork with it.
 *
 * Everything here is **best-effort**. The ledger and the metering RPC live in
 * migrations that are not part of this branch, so a project that has the
 * `pm_*` schema but not the audit ledger must still get a working Project
 * Manager Agent — it just gets one whose runs are not traced. A missing trace is
 * a degraded feature; a run that refuses to start because it could not write a
 * log line is a broken one.
 *
 * The one thing that is *not* best-effort is the honesty of what does get
 * written. The `agent_runs_guard` trigger enforces that identity columns are
 * immutable, a terminal status cannot be rewritten, and counters only climb — so
 * the code here only has to write truthfully, not defensively.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const PM_AGENT_KEY = 'project_manager';
export const PM_AGENT_LABEL = 'Project Manager Agent';

/** Codes meaning "that table or function is not on this project". */
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

/**
 * Open a run. Returns a handle whose `id` is null when the ledger is absent —
 * every other function here then becomes a no-op, so callers never need to
 * branch on whether tracing is available.
 */
export async function startRun(
  supabase: SupabaseClient,
  input: StartRunInput,
): Promise<RunHandle> {
  try {
    const { data, error } = await supabase
      .from('agent_runs')
      .insert({
        org_id: input.orgId,
        agent_key: PM_AGENT_KEY,
        agent_label: PM_AGENT_LABEL,
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
      if (!isAbsent(error)) console.warn('[pm] could not open agent run:', error.message);
      return { id: null, seq: 0 };
    }
    return { id: data.id as string, seq: 0 };
  } catch (err) {
    console.warn('[pm] could not open agent run:', (err as Error).message);
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

/** Append a step. Silently does nothing when tracing is unavailable. */
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
      // org_id and seq are filled by the ledger's own trigger.
      type: input.type,
      action: input.action ?? null,
      // The column caps at 8000; truncate rather than lose the whole step.
      detail: input.detail ? input.detail.slice(0, 8000) : null,
      target: input.target ? input.target.slice(0, 2000) : null,
      payload: input.payload ?? null,
      status: input.status ?? 'ok',
      duration_ms: input.durationMs ?? null,
    });
    if (error && !isAbsent(error)) {
      console.warn('[pm] could not write agent step:', error.message);
    }
  } catch (err) {
    console.warn('[pm] could not write agent step:', (err as Error).message);
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
      console.warn('[pm] could not close agent run:', error.message);
    }
  } catch (err) {
    console.warn('[pm] could not close agent run:', (err as Error).message);
  }
}

/* ------------------------------------------------------------------ *
 * Metering
 * ------------------------------------------------------------------ */

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

/**
 * Record token usage against the org's credits.
 *
 * Prices come from the rate card inside `record_usage` — nothing in application
 * code hardcodes a price, because a rate card that disagrees with the invoice is
 * worse than no rate card.
 */
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
      console.warn('[pm] could not record usage:', error.message);
    }
    recordTokenUsageAsync(supabase, {
      orgId: usage.orgId,
      requestId: `pm:${usage.requestId}`,
      feature: usage.feature,
      source: usage.feature,
      modelId: usage.modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheTokens:
        (usage.cacheReadTokens ?? 0) +
        (usage.cacheWrite5mTokens ?? 0) +
        (usage.cacheWrite1hTokens ?? 0),
    });
  } catch (err) {
    console.warn('[pm] could not record usage:', (err as Error).message);
  }
}

/**
 * The org's remaining credit, or null when billing is not installed on this
 * project. Null means "cannot tell" and must be treated as permission to
 * proceed — refusing to run because the billing tables are missing would make
 * the agent undeployable on a bare project.
 */
export async function creditBalanceNanos(
  supabase: SupabaseClient,
  orgId: string,
): Promise<number | null> {
  try {
    const { data, error } = await supabase.rpc('credit_balance', { p_org: orgId });
    if (error || !data) return null;
    const total = (data as any).total_nanos ?? (data as any).balance_nanos ?? null;
    return total === null ? null : Number(total);
  } catch {
    return null;
  }
}
