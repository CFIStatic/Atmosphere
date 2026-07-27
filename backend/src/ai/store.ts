import type { SupabaseClient } from '@supabase/supabase-js';
import { statsKey } from './policy.js';
import type { ProviderId } from './providers/types.js';
import type { Arm, ArmStats, Disposition, TaskType } from './types.js';

/**
 * Persistence for the learning loop.
 *
 * Every read here runs under the **caller's JWT**, so RLS decides what is
 * visible — the same rule the rest of the app follows. Writes go through the
 * SECURITY DEFINER functions in the migration rather than direct inserts, which
 * is what stops a client from fabricating a run in another org or hand-editing
 * the posteriors that drive routing.
 *
 * ── On caching ───────────────────────────────────────────────────────────────
 * Arms and stats are global and read on the hot path of every task execution.
 * Fetching them fresh each time would add two round trips to work that already
 * takes seconds, so both are cached in-process for a few seconds.
 *
 * Stale posteriors are harmless *here* specifically because the policy is
 * randomised: Thompson sampling already treats its inputs as uncertain, so a
 * few seconds of lag changes the sampling distribution imperceptibly. This
 * would not be a safe trade for a deterministic argmax policy, which could
 * stampede an entire cache window onto a stale winner.
 *
 * The cache is per-process and unsynchronised. That is fine for reads; it is
 * exactly why *writes* are atomic in the database instead.
 */

const ARMS_TTL_MS = 60_000;
const STATS_TTL_MS = 15_000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const armsCache = new Map<TaskType, CacheEntry<Arm[]>>();
const statsCache = new Map<TaskType, CacheEntry<Map<string, ArmStats>>>();

/** Drops cached routing state. Called after any promotion or retirement. */
export function invalidatePolicyCache(taskType?: TaskType): void {
  if (taskType) {
    armsCache.delete(taskType);
    statsCache.delete(taskType);
    return;
  }
  armsCache.clear();
  statsCache.clear();
}

/* ─── Arms ─────────────────────────────────────────────────────────────────── */

interface ArmRow {
  id: string;
  task_type: string;
  provider: string;
  model: string;
  prompt_variant: string;
  temperature: number | null;
  max_output_tokens: number | null;
  status: string;
}

function toArm(row: ArmRow): Arm {
  return {
    id: row.id,
    taskType: row.task_type as TaskType,
    provider: row.provider as ProviderId,
    model: row.model,
    promptVariant: row.prompt_variant,
    temperature: row.temperature ?? undefined,
    maxOutputTokens: row.max_output_tokens ?? undefined,
    status: row.status as Arm['status'],
  };
}

export async function loadArms(supabase: SupabaseClient, taskType: TaskType): Promise<Arm[]> {
  const cached = armsCache.get(taskType);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const { data, error } = await supabase
    .from('ai_arms')
    .select('id, task_type, provider, model, prompt_variant, temperature, max_output_tokens, status')
    .eq('task_type', taskType)
    .neq('status', 'retired');

  if (error) throw new Error(`Failed to load arms: ${error.message}`);

  const arms = (data ?? []).map((row) => toArm(row as ArmRow));
  armsCache.set(taskType, { value: arms, expiresAt: Date.now() + ARMS_TTL_MS });
  return arms;
}

/* ─── Stats ────────────────────────────────────────────────────────────────── */

interface StatsRow {
  arm_id: string;
  context_key: string;
  trials: number;
  reward_sum: number;
  alpha: number;
  beta: number;
  avg_cost_usd: number;
  avg_latency_ms: number;
}

function toStats(row: StatsRow): ArmStats {
  return {
    armId: row.arm_id,
    contextKey: row.context_key,
    trials: row.trials,
    rewardSum: Number(row.reward_sum),
    alpha: Number(row.alpha),
    beta: Number(row.beta),
    avgCostUsd: Number(row.avg_cost_usd),
    avgLatencyMs: Number(row.avg_latency_ms),
  };
}

/**
 * All posteriors for a task type, keyed by `${armId} ${contextKey}`.
 *
 * Loaded per *task* rather than per (arm, context) pair on purpose: the row
 * count is bounded by arms × context levels — tens of rows, not thousands — so
 * one query beats N, and it makes the whole set cacheable as a unit.
 */
export async function loadStats(
  supabase: SupabaseClient,
  taskType: TaskType,
  armIds: string[],
): Promise<Map<string, ArmStats>> {
  const cached = statsCache.get(taskType);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (armIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('ai_arm_stats')
    .select('arm_id, context_key, trials, reward_sum, alpha, beta, avg_cost_usd, avg_latency_ms')
    .in('arm_id', armIds);

  if (error) throw new Error(`Failed to load arm stats: ${error.message}`);

  const map = new Map<string, ArmStats>();
  for (const row of data ?? []) {
    const stats = toStats(row as StatsRow);
    map.set(statsKey(stats.armId, stats.contextKey), stats);
  }

  statsCache.set(taskType, { value: map, expiresAt: Date.now() + STATS_TTL_MS });
  return map;
}

/* ─── Runs ─────────────────────────────────────────────────────────────────── */

export interface RecordRunInput {
  orgId: string;
  taskType: TaskType;
  contextKey: string;
  contextKeys: string[];
  armId: string;
  provider: ProviderId;
  model: string;
  promptVariant: string;
  mode: 'serve' | 'shadow';
  explored: boolean;
  selectionReason: string;
  inputDigest: string;
  inputPayload: unknown;
  outputText: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  verifierScore: number;
  verifierPassed: boolean;
  verifierDetail: unknown;
  reward: number;
  alphaPrior: number;
  betaPrior: number;
}

export async function recordRun(supabase: SupabaseClient, input: RecordRunInput): Promise<string> {
  const { data, error } = await supabase.rpc('ai_record_run', {
    p_org_id: input.orgId,
    p_task_type: input.taskType,
    p_context_key: input.contextKey,
    p_context_keys: input.contextKeys,
    p_arm_id: input.armId,
    p_provider: input.provider,
    p_model: input.model,
    p_prompt_variant: input.promptVariant,
    p_mode: input.mode,
    p_explored: input.explored,
    p_selection_reason: input.selectionReason,
    p_input_digest: input.inputDigest,
    p_input_payload: input.inputPayload,
    p_output_text: input.outputText,
    p_input_tokens: input.inputTokens,
    p_output_tokens: input.outputTokens,
    p_cost_usd: input.costUsd,
    p_latency_ms: input.latencyMs,
    p_verifier_score: input.verifierScore,
    p_verifier_passed: input.verifierPassed,
    p_verifier_detail: input.verifierDetail,
    p_reward: input.reward,
    p_alpha_prior: input.alphaPrior,
    p_beta_prior: input.betaPrior,
  });

  if (error) throw new Error(`Failed to record run: ${error.message}`);
  return data as string;
}

export async function resolveRun(
  supabase: SupabaseClient,
  runId: string,
  disposition: Disposition,
  editRatio: number | null,
  reward: number,
): Promise<void> {
  const { error } = await supabase.rpc('ai_resolve_run', {
    p_run_id: runId,
    p_disposition: disposition,
    p_edit_ratio: editRatio,
    p_reward: reward,
  });
  if (error) throw new Error(`Failed to resolve run: ${error.message}`);
}

/** A run the caller is allowed to see, for feedback and audit. */
export async function getRun(supabase: SupabaseClient, runId: string) {
  const { data, error } = await supabase
    .from('ai_runs')
    .select('id, org_id, task_type, context_key, arm_id, provider, model, prompt_variant, output_text, verifier_score, cost_usd, latency_ms, reward, reward_status, disposition, created_at')
    .eq('id', runId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load run: ${error.message}`);
  return data;
}

/* ─── Exemplars ────────────────────────────────────────────────────────────── */

export interface ExemplarRow {
  input_payload: unknown;
  output_text: string;
  reward: number;
}

/**
 * The org's best past work for this task, highest reward first.
 *
 * Scoped to the caller's org by RLS. This is the org-local half of learning:
 * global stats say *which model*, exemplars say *how this particular company
 * writes a scope*.
 */
export async function loadExemplars(
  supabase: SupabaseClient,
  orgId: string,
  taskType: TaskType,
  limit: number,
): Promise<ExemplarRow[]> {
  if (limit <= 0) return [];
  const { data, error } = await supabase
    .from('ai_exemplars')
    .select('input_payload, output_text, reward')
    .eq('org_id', orgId)
    .eq('task_type', taskType)
    .eq('active', true)
    .order('reward', { ascending: false })
    .limit(limit);

  // Exemplars are an enhancement, never a requirement. If the lookup fails the
  // task must still run — degraded, not broken.
  if (error) {
    console.warn(`[ai] exemplar lookup failed (continuing without): ${error.message}`);
    return [];
  }
  return (data ?? []) as ExemplarRow[];
}

/* ─── Org lookup ───────────────────────────────────────────────────────────── */

/** The caller's org id. Every run must be attributed to one. */
export async function getCallerOrgId(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('org_members')
    .select('org_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) throw new Error(`Failed to resolve organization: ${error.message}`);
  return (data?.[0]?.org_id as string | undefined) ?? null;
}
