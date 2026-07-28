import type { SupabaseClient } from '@supabase/supabase-js';
import { createUserClient, createAdminClient } from './supabase.js';
import {
  AGENT_ACTOR_TYPES,
  AGENT_RUN_STATUSES,
  AGENT_STEP_STATUSES,
  AGENT_STEP_TYPES,
} from './validation.js';

/**
 * The write side of the audit ledger.
 *
 * Any agent in this process records its work through these three calls:
 *
 *   const run = await startRun(w, { orgId, agentKey: 'computer_use', title });
 *   await recordStep(w, run.id, { type: 'tool_call', action: 'click', detail });
 *   await finishRun(w, run.id, { status: 'succeeded', result });
 *
 * Two rules shape everything below.
 *
 * **Recording must never break the work it records.** A failed insert here
 * would turn a degraded audit trail into a failed job, which is strictly worse:
 * a gap in the trail is visible and recoverable, an outage is neither. So no
 * function in this module throws. They return a result the caller may inspect
 * and is free to ignore — the HTTP ingest routes inspect it, in-process agents
 * generally do not.
 *
 * **Payloads are evidence, not a dumping ground.** A trace of a real run passes
 * through passwords typed into a login form and megabytes of screenshot PNG.
 * Neither belongs in a table that every member of the org can read forever, so
 * `sanitize` below redacts secret-shaped keys and refuses to carry image bytes
 * at all. This is the last line before Postgres; it is deliberately not the
 * caller's responsibility to remember.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export type RunStatus = (typeof AGENT_RUN_STATUSES)[number];
export type StepStatus = (typeof AGENT_STEP_STATUSES)[number];
export type ActorType = (typeof AGENT_ACTOR_TYPES)[number];
export type StepType = (typeof AGENT_STEP_TYPES)[number];

/** Column ceilings from db/audit_ledger.sql, enforced here so a long value is
 *  truncated into the ledger rather than rejected by it. */
const LIMITS = {
  title: 500,
  summary: 4000,
  agentLabel: 120,
  actorLabel: 120,
  action: 120,
  detail: 8000,
  target: 2000,
  error: 4000,
  /** Serialized payload budget. Past this the payload is replaced by a note. */
  payloadBytes: 16_000,
  payloadString: 2000,
  payloadArray: 50,
  payloadDepth: 6,
} as const;

export interface StartRunInput {
  orgId: string;
  agentKey: string;
  title: string;
  agentLabel?: string | null;
  actorType?: ActorType;
  actorUserId?: string | null;
  actorLabel?: string | null;
  parentRunId?: string | null;
  status?: RunStatus;
  input?: unknown;
  /** Provenance when mirroring another table. Unique per (table, id). */
  sourceTable?: string | null;
  sourceId?: string | null;
  startedAt?: string | null;
}

export interface StepInput {
  type?: StepType;
  action?: string | null;
  detail?: string | null;
  target?: string | null;
  payload?: unknown;
  status?: StepStatus;
  error?: string | null;
  seq?: number;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationMs?: number | null;
}

export interface FinishRunInput {
  status: RunStatus;
  summary?: string | null;
  result?: unknown;
  error?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  finishedAt?: string | null;
}

export interface AuditResult<T = void> {
  ok: boolean;
  data?: T;
  error?: string;
}

/**
 * Where audit writes go.
 *
 * A run started by a person is written with that person's JWT, so the ledger
 * obeys exactly the RLS the request did. Unattended work (a scheduled backup,
 * an agent that outlives the session that started it) has no JWT to borrow and
 * goes through the service-role client instead — which is why `system` and
 * `schedule` exist as actor types rather than being flattened into a fake user.
 */
export function auditWriter(accessToken?: string | null): SupabaseClient | null {
  if (accessToken) return createUserClient(accessToken);
  return createAdminClient();
}

function clip(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Key names whose values are never safe to keep in a readable-forever table. */
const SECRET_KEY = /pass|secret|token|credential|authorization|auth[_-]?key|api[_-]?key|\bpin\b|ssn|cvv|card[_-]?number|private[_-]?key/i;

/** Key names that carry pixels rather than facts. */
const BINARY_KEY = /^(image|screenshot|screen|thumbnail|photo|frame|data_?url|base64|bytes|buffer)$/i;

const DATA_URL = /^data:[^;,]*;base64,/i;

/**
 * Reduces an arbitrary agent payload to something an audit table can hold:
 * secrets redacted, images described rather than embedded, and the whole thing
 * bounded in depth, breadth and length.
 *
 * Redaction is by key name, which is a heuristic — a password stored under a
 * key called `value` still gets through. It is the cheap 90% and it costs
 * nothing; agents handling credentials should also not put them in a step.
 */
function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;

  if (typeof value === 'string') {
    if (DATA_URL.test(value)) return `[binary omitted · ${value.length} chars]`;
    return clip(value, LIMITS.payloadString);
  }

  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value !== 'object') return String(value);

  if (depth >= LIMITS.payloadDepth) return '[nested too deeply]';

  if (Array.isArray(value)) {
    const kept = value.slice(0, LIMITS.payloadArray).map((item) => sanitize(item, depth + 1));
    if (value.length > LIMITS.payloadArray) {
      kept.push(`[${value.length - LIMITS.payloadArray} more items omitted]`);
    }
    return kept;
  }

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(key)) {
      out[key] = '[redacted]';
    } else if (BINARY_KEY.test(key) && typeof item === 'string') {
      out[key] = `[binary omitted · ${item.length} chars]`;
    } else {
      out[key] = sanitize(item, depth + 1);
    }
  }
  return out;
}

/** Sanitizes, then drops the payload entirely if it is still too large. */
export function preparePayload(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  const cleaned = sanitize(value);
  try {
    const encoded = JSON.stringify(cleaned);
    if (encoded && encoded.length > LIMITS.payloadBytes) {
      return { omitted: `payload of ${encoded.length} chars exceeded the audit size limit` };
    }
    return cleaned;
  } catch {
    return { omitted: 'payload could not be serialized' };
  }
}

function fail(scope: string, message: string): AuditResult<never> {
  // Console rather than a thrown error: see the module header.
  console.error(`[audit] ${scope}: ${message}`);
  return { ok: false, error: message };
}

/** Opens a run and returns its id. */
export async function startRun(
  supabase: SupabaseClient | null,
  input: StartRunInput,
): Promise<AuditResult<{ id: string }>> {
  if (!supabase) return fail('startRun', 'no audit writer available');
  try {
    const { data, error } = await supabase
      .from('agent_runs')
      .insert({
        org_id: input.orgId,
        agent_key: input.agentKey,
        agent_label: clip(input.agentLabel, LIMITS.agentLabel),
        actor_type: input.actorType ?? 'user',
        actor_user_id: input.actorUserId ?? null,
        actor_label: clip(input.actorLabel, LIMITS.actorLabel),
        parent_run_id: input.parentRunId ?? null,
        title: clip(input.title, LIMITS.title) ?? 'Untitled run',
        status: input.status ?? 'running',
        input: preparePayload(input.input),
        source_table: input.sourceTable ?? null,
        source_id: input.sourceId ?? null,
        started_at: input.startedAt ?? new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) return fail('startRun', error.message);
    return { ok: true, data: { id: data.id as string } };
  } catch (err) {
    return fail('startRun', err instanceof Error ? err.message : 'unexpected failure');
  }
}

/** Appends one step to a run's trace. */
export async function recordStep(
  supabase: SupabaseClient | null,
  runId: string,
  step: StepInput,
): Promise<AuditResult<{ id: string; seq: number }>> {
  const results = await recordSteps(supabase, runId, [step]);
  if (!results.ok || !results.data?.length) {
    return { ok: results.ok, error: results.error } as AuditResult<{ id: string; seq: number }>;
  }
  return { ok: true, data: results.data[0] };
}

/**
 * Appends several steps in one round trip.
 *
 * Steps without an explicit `seq` are numbered by a database trigger, which
 * reads the current maximum per run — so a batch has to number itself, or every
 * row in it would claim the same position and all but one would be rejected.
 */
export async function recordSteps(
  supabase: SupabaseClient | null,
  runId: string,
  steps: StepInput[],
): Promise<AuditResult<{ id: string; seq: number }[]>> {
  if (!supabase) return fail('recordSteps', 'no audit writer available');
  if (!steps.length) return { ok: true, data: [] };

  try {
    let nextSeq: number | null = null;
    if (steps.length > 1 && steps.some((step) => step.seq === undefined)) {
      const { data } = await supabase
        .from('agent_run_steps')
        .select('seq')
        .eq('run_id', runId)
        .order('seq', { ascending: false })
        .limit(1);
      nextSeq = ((data?.[0]?.seq as number | undefined) ?? 0) + 1;
    }

    const rows = steps.map((step, index) => ({
      run_id: runId,
      seq: step.seq ?? (nextSeq === null ? undefined : nextSeq + index),
      type: step.type ?? 'event',
      action: clip(step.action, LIMITS.action),
      detail: clip(step.detail, LIMITS.detail),
      target: clip(step.target, LIMITS.target),
      payload: preparePayload(step.payload),
      status: step.status ?? (step.error ? 'error' : 'ok'),
      error: clip(step.error, LIMITS.error),
      started_at: step.startedAt ?? null,
      finished_at: step.finishedAt ?? null,
      duration_ms: step.durationMs ?? null,
    }));

    const { data, error } = await supabase.from('agent_run_steps').insert(rows).select('id, seq');
    if (error) return fail('recordSteps', error.message);
    return { ok: true, data: (data ?? []) as { id: string; seq: number }[] };
  } catch (err) {
    return fail('recordSteps', err instanceof Error ? err.message : 'unexpected failure');
  }
}

/**
 * Closes a run.
 *
 * Token counters are absolute totals, not deltas: the database refuses to let
 * them fall, so a caller that reports a running total on every update stays
 * consistent while one reporting deltas would not.
 */
export async function finishRun(
  supabase: SupabaseClient | null,
  runId: string,
  outcome: FinishRunInput,
): Promise<AuditResult> {
  if (!supabase) return fail('finishRun', 'no audit writer available');
  try {
    const patch: Record<string, unknown> = {
      status: outcome.status,
      finished_at: outcome.finishedAt ?? new Date().toISOString(),
    };
    if (outcome.summary !== undefined) patch.summary = clip(outcome.summary, LIMITS.summary);
    if (outcome.result !== undefined) patch.result = preparePayload(outcome.result);
    if (outcome.error !== undefined) patch.error = clip(outcome.error, LIMITS.error);
    if (outcome.inputTokens !== undefined) patch.input_tokens = Math.max(0, outcome.inputTokens);
    if (outcome.outputTokens !== undefined) patch.output_tokens = Math.max(0, outcome.outputTokens);

    const { error } = await supabase.from('agent_runs').update(patch).eq('id', runId);
    if (error) return fail('finishRun', error.message);
    return { ok: true };
  } catch (err) {
    return fail('finishRun', err instanceof Error ? err.message : 'unexpected failure');
  }
}

/** Reports progress on a run without closing it. */
export async function updateRun(
  supabase: SupabaseClient | null,
  runId: string,
  patch: { status?: RunStatus; summary?: string | null; inputTokens?: number; outputTokens?: number },
): Promise<AuditResult> {
  if (!supabase) return fail('updateRun', 'no audit writer available');
  try {
    const body: Record<string, unknown> = {};
    if (patch.status !== undefined) body.status = patch.status;
    if (patch.summary !== undefined) body.summary = clip(patch.summary, LIMITS.summary);
    if (patch.inputTokens !== undefined) body.input_tokens = Math.max(0, patch.inputTokens);
    if (patch.outputTokens !== undefined) body.output_tokens = Math.max(0, patch.outputTokens);
    if (!Object.keys(body).length) return { ok: true };

    const { error } = await supabase.from('agent_runs').update(body).eq('id', runId);
    if (error) return fail('updateRun', error.message);
    return { ok: true };
  } catch (err) {
    return fail('updateRun', err instanceof Error ? err.message : 'unexpected failure');
  }
}

/**
 * The org a user acts within. Every audit row is org-scoped, and a caller who
 * has not finished onboarding has no org to file work under.
 */
export async function resolveOrgId(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('org_members')
    .select('org_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) return null;
  return (data?.[0]?.org_id as string | undefined) ?? null;
}
