import type { SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { createAdminClient } from '../lib/supabase.js';
import { runArm } from './executor.js';
import { posteriorLowerBound, posteriorMean } from './policy.js';
import { invalidatePolicyCache } from './store.js';
import { getTaskSpec, listTaskSpecs } from './taskTypes.js';
import type { Arm, TaskType } from './types.js';

/**
 * The offline half of the loop: what turns accumulated evidence into a change
 * in behaviour.
 *
 * Nothing here runs on a user's request. Routing reacts to new data within
 * seconds (the posteriors are updated inline), but *promotion* — actually
 * changing what most traffic gets — happens here, deliberately, behind a gate,
 * on a schedule. Separating the fast path from the consequential one is what
 * makes the system safe to leave running unattended.
 *
 * Run it from a cron: `npm run learn` (see package.json).
 *
 * Requires the service role key: these writes touch the global policy tables,
 * which have no write policy for ordinary users by design. Without the key the
 * cycle no-ops loudly rather than half-running.
 */

/* ─── Promotion gate ───────────────────────────────────────────────────────── */

/** Evidence required before a challenger may be considered at all. */
const PROMOTION_MIN_TRIALS_MULTIPLIER = 2;

/**
 * How much better a challenger must be to justify the switch.
 *
 * Not zero, on purpose. Swapping champions has costs the reward function does
 * not see — output style shifts under users mid-week, cached prompts are
 * invalidated, and any promotion is a chance to be wrong. Requiring a real
 * margin means we only pay that when the gain is worth having.
 */
const PROMOTION_MARGIN = 0.02;

export interface PromotionDecision {
  taskType: TaskType;
  candidateId: string;
  candidateLabel: string;
  championId: string | null;
  championLabel: string | null;
  action: 'promoted' | 'retired' | 'held';
  reason: string;
  candidateMean?: number;
  championMean?: number;
  trials?: number;
}

interface StatsRow {
  arm_id: string;
  context_key: string;
  trials: number;
  alpha: number;
  beta: number;
  avg_cost_usd: number;
}

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

function label(arm: ArmRow): string {
  return `${arm.provider}/${arm.model}[${arm.prompt_variant}]`;
}

function toArm(row: ArmRow): Arm {
  return {
    id: row.id,
    taskType: row.task_type as TaskType,
    provider: row.provider as Arm['provider'],
    model: row.model,
    promptVariant: row.prompt_variant,
    temperature: row.temperature ?? undefined,
    maxOutputTokens: row.max_output_tokens ?? undefined,
    status: row.status as Arm['status'],
  };
}

/**
 * Decide the fate of every candidate for one task type.
 *
 * Comparison is at the **task level** (`context_key = taskType`), not per
 * narrow slice. A champion is the default for all contexts, so it should be
 * chosen on the broadest evidence; per-slice specialisation is handled by the
 * router's hierarchical backoff, not by promoting a different champion for each
 * corner of the space.
 *
 * The test is *lower bound of the challenger* vs *mean of the champion*. That
 * asymmetry is the safety property: a challenger with a flattering average over
 * few trials has a wide interval and a low bound, so it cannot win on luck. The
 * incumbent gets the benefit of the doubt; the challenger has to prove itself.
 */
export async function evaluatePromotions(
  admin: SupabaseClient,
  taskType: TaskType,
): Promise<PromotionDecision[]> {
  const { data: armRows, error: armErr } = await admin
    .from('ai_arms')
    .select('id, task_type, provider, model, prompt_variant, temperature, max_output_tokens, status')
    .eq('task_type', taskType)
    .neq('status', 'retired');
  if (armErr) throw new Error(`Failed to load arms: ${armErr.message}`);

  const arms = (armRows ?? []) as ArmRow[];
  const champion = arms.find((arm) => arm.status === 'champion') ?? null;
  const candidates = arms.filter((arm) => arm.status === 'candidate');
  if (candidates.length === 0) return [];

  const { data: statsRows, error: statsErr } = await admin
    .from('ai_arm_stats')
    .select('arm_id, context_key, trials, alpha, beta, avg_cost_usd')
    .eq('context_key', taskType)
    .in('arm_id', arms.map((arm) => arm.id));
  if (statsErr) throw new Error(`Failed to load stats: ${statsErr.message}`);

  const stats = new Map((statsRows ?? []).map((row) => [(row as StatsRow).arm_id, row as StatsRow]));
  const championStats = champion ? stats.get(champion.id) : undefined;
  const championMean = championStats
    ? posteriorMean(Number(championStats.alpha), Number(championStats.beta))
    : 0;

  const required = config.ai.learning.minTrialsPerArm * PROMOTION_MIN_TRIALS_MULTIPLIER;
  const decisions: PromotionDecision[] = [];

  for (const candidate of candidates) {
    const row = stats.get(candidate.id);
    const base: PromotionDecision = {
      taskType,
      candidateId: candidate.id,
      candidateLabel: label(candidate),
      championId: champion?.id ?? null,
      championLabel: champion ? label(champion) : null,
      action: 'held',
      reason: '',
      championMean,
    };

    if (!row || row.trials < required) {
      decisions.push({
        ...base,
        trials: row?.trials ?? 0,
        reason: `needs ${required} trials, has ${row?.trials ?? 0}`,
      });
      continue;
    }

    const alpha = Number(row.alpha);
    const beta = Number(row.beta);
    const mean = posteriorMean(alpha, beta);
    const lower = posteriorLowerBound(alpha, beta);
    const upper = 2 * mean - lower; // symmetric normal approximation

    // Clearly worse than the incumbent, with enough data to be sure: stop
    // spending the exploration budget on it.
    if (champion && upper < championMean - PROMOTION_MARGIN) {
      await retireArm(admin, candidate.id, `underperformed champion (${mean.toFixed(3)} vs ${championMean.toFixed(3)})`);
      decisions.push({
        ...base,
        action: 'retired',
        trials: row.trials,
        candidateMean: mean,
        reason: `retired: upper bound ${upper.toFixed(3)} below champion mean ${championMean.toFixed(3)}`,
      });
      continue;
    }

    if (champion && lower <= championMean + PROMOTION_MARGIN) {
      decisions.push({
        ...base,
        trials: row.trials,
        candidateMean: mean,
        reason: `not yet decisive: lower bound ${lower.toFixed(3)} vs champion ${championMean.toFixed(3)}`,
      });
      continue;
    }

    // Statistically ahead. One gate left — and it is the one that keeps this
    // system trustworthy over months rather than days.
    const regression = await checkGoldenSet(admin, taskType, toArm(candidate));
    if (!regression.passed) {
      decisions.push({
        ...base,
        trials: row.trials,
        candidateMean: mean,
        reason: `blocked by golden set: ${regression.detail}`,
      });
      continue;
    }

    await promoteArm(admin, taskType, candidate.id, champion?.id ?? null);
    decisions.push({
      ...base,
      action: 'promoted',
      trials: row.trials,
      candidateMean: mean,
      reason: `promoted: lower bound ${lower.toFixed(3)} > champion mean ${championMean.toFixed(3)}, golden set ${regression.detail}`,
    });

    // Only one promotion per task per cycle. The new champion has to be
    // measured *as champion*, on champion traffic, before the next challenger
    // is judged against it.
    break;
  }

  return decisions;
}

/**
 * The regression suite: a fixed set of cases a challenger must not fail.
 *
 * This is the floor under everything else. Bandit statistics answer "is this
 * arm better on the traffic we happened to see?" — which is a different and
 * weaker question than "is this arm still correct on the things we know
 * matter?". Traffic drifts, rare-but-critical cases go months without
 * appearing, and an arm can look excellent on the easy 95%. The golden set is
 * how a case stays permanently in scope after someone was burned by it once.
 */
export async function checkGoldenSet(
  admin: SupabaseClient,
  taskType: TaskType,
  arm: Arm,
): Promise<{ passed: boolean; detail: string }> {
  const { data, error } = await admin
    .from('ai_golden_cases')
    .select('id, label, input_payload, min_score')
    .eq('task_type', taskType)
    .eq('active', true);

  if (error) return { passed: false, detail: `could not load golden cases: ${error.message}` };

  const cases = data ?? [];
  // No cases means no evidence, and no evidence must not read as a pass for a
  // high-stakes task — those are exactly the ones where a silent regression is
  // expensive. Low-stakes tasks are allowed through, since blocking every
  // promotion until someone writes fixtures would stall the loop entirely.
  if (cases.length === 0) {
    const spec = getTaskSpec(taskType);
    return spec.highStakes
      ? { passed: false, detail: 'no golden cases defined for a high-stakes task' }
      : { passed: true, detail: 'no golden cases defined (low-stakes task)' };
  }

  const spec = getTaskSpec(taskType);
  const failures: string[] = [];

  for (const testCase of cases) {
    try {
      // No exemplars: the golden set measures the arm, not the org's accumulated
      // house style, so it must be identical for every arm and every tenant.
      const outcome = await runArm(spec, arm, testCase.input_payload, []);
      const minScore = Number(testCase.min_score ?? 0.9);
      if (!outcome.verifier.passed || outcome.verifier.score < minScore) {
        failures.push(`${testCase.label} (${outcome.verifier.score.toFixed(2)} < ${minScore})`);
      }
    } catch (err) {
      failures.push(`${testCase.label} (errored: ${err instanceof Error ? err.message : 'unknown'})`);
    }
  }

  return failures.length === 0
    ? { passed: true, detail: `${cases.length}/${cases.length} cases passed` }
    : { passed: false, detail: `failed ${failures.length}/${cases.length}: ${failures.join('; ')}` };
}

async function promoteArm(
  admin: SupabaseClient,
  taskType: TaskType,
  candidateId: string,
  championId: string | null,
): Promise<void> {
  // Demote first: a unique index enforces one champion per task type, so the
  // reverse order would fail. The old champion becomes a candidate rather than
  // being retired — if the new one turns out worse in production, the loop can
  // hand the crown straight back without human intervention.
  if (championId) {
    const { error } = await admin
      .from('ai_arms')
      .update({ status: 'candidate' })
      .eq('id', championId);
    if (error) throw new Error(`Failed to demote champion: ${error.message}`);
  }

  const { error } = await admin
    .from('ai_arms')
    .update({ status: 'champion', promoted_at: new Date().toISOString() })
    .eq('id', candidateId);
  if (error) throw new Error(`Failed to promote candidate: ${error.message}`);

  invalidatePolicyCache(taskType);
}

async function retireArm(admin: SupabaseClient, armId: string, reason: string): Promise<void> {
  const { error } = await admin
    .from('ai_arms')
    .update({ status: 'retired', retired_at: new Date().toISOString(), retired_reason: reason })
    .eq('id', armId);
  if (error) throw new Error(`Failed to retire arm: ${error.message}`);
  invalidatePolicyCache();
}

/* ─── Exemplar mining ──────────────────────────────────────────────────────── */

/** Only work a human actually accepted becomes an exemplar. */
const EXEMPLAR_MIN_REWARD = 0.85;
/** Keep the set small and current — stale house style is worse than none. */
const EXEMPLARS_PER_ORG_TASK = 5;

/**
 * Promote the best recent runs into few-shot exemplars for their org.
 *
 * The requirement is `reward_status = 'final'` — a provisional reward means
 * only a machine has seen it, and "passed our own checks" is not evidence that
 * a human found it useful. Exemplars are meant to teach house style, and only a
 * human can confirm that something matched it.
 */
export async function mineExemplars(admin: SupabaseClient): Promise<number> {
  const { data, error } = await admin
    .from('ai_runs')
    .select('id, org_id, task_type, context_key, input_payload, output_text, reward')
    .eq('reward_status', 'final')
    .eq('mode', 'serve')
    .in('disposition', ['accepted', 'edited_minor'])
    .gte('reward', EXEMPLAR_MIN_REWARD)
    .order('reward', { ascending: false })
    .limit(500);

  if (error) throw new Error(`Failed to load runs for mining: ${error.message}`);

  let inserted = 0;
  const seen = new Map<string, number>();

  for (const run of data ?? []) {
    const key = `${run.org_id}:${run.task_type}`;
    const count = seen.get(key) ?? 0;
    if (count >= EXEMPLARS_PER_ORG_TASK) continue;

    const { data: existing } = await admin
      .from('ai_exemplars')
      .select('id')
      .eq('source_run_id', run.id)
      .maybeSingle();
    if (existing) {
      seen.set(key, count + 1);
      continue;
    }

    const { error: insertErr } = await admin.from('ai_exemplars').insert({
      org_id: run.org_id,
      task_type: run.task_type,
      context_key: run.context_key,
      input_payload: run.input_payload,
      output_text: run.output_text,
      reward: run.reward,
      source_run_id: run.id,
    });
    if (insertErr) {
      console.warn(`[ai] exemplar insert failed for run ${run.id}: ${insertErr.message}`);
      continue;
    }

    seen.set(key, count + 1);
    inserted += 1;
  }

  // Retire everything past the cap, newest and best first. Done as a second
  // pass so a newly-mined exemplar can displace an older, weaker one.
  for (const key of seen.keys()) {
    const [orgId, taskType] = key.split(':');
    await trimExemplars(admin, orgId, taskType);
  }

  return inserted;
}

async function trimExemplars(admin: SupabaseClient, orgId: string, taskType: string): Promise<void> {
  const { data, error } = await admin
    .from('ai_exemplars')
    .select('id')
    .eq('org_id', orgId)
    .eq('task_type', taskType)
    .eq('active', true)
    .order('reward', { ascending: false })
    .range(EXEMPLARS_PER_ORG_TASK, 999);

  if (error || !data?.length) return;
  await admin
    .from('ai_exemplars')
    .update({ active: false })
    .in('id', data.map((row) => row.id));
}

/* ─── Preference export ────────────────────────────────────────────────────── */

export interface PreferencePair {
  taskType: string;
  input: unknown;
  chosen: string;
  rejected: string;
  chosenReward: number;
  rejectedReward: number;
  margin: number;
}

/**
 * Export preference pairs for fine-tuning an open-weights model (DPO/ORPO).
 *
 * This is where the `oss` provider stops being just a cheap arm and becomes the
 * compounding asset. Every run through this platform is a labelled comparison:
 * the same job, executed by different models, scored by the same verifier and
 * the same humans. That is precisely the shape of a preference dataset, and it
 * is generated as a *by-product of doing the work* — no annotation budget, no
 * labelling vendor.
 *
 * Train on it and the open model gets specifically better at restoration and
 * construction work, at a fraction of frontier inference cost. It then re-enters
 * the pool as a new candidate arm and has to win on the same evidence as anyone
 * else. Nothing about the loop changes to accommodate it — which is the payoff
 * of having made the action space provider-agnostic in the first place.
 *
 * Pairs are matched on `input_digest`, so both sides answered a byte-identical
 * input. A margin threshold keeps out pairs where the two outputs were
 * effectively tied — training on noise teaches noise.
 */
export async function exportPreferencePairs(
  admin: SupabaseClient,
  taskType: TaskType,
  minMargin = 0.15,
  limit = 2000,
): Promise<PreferencePair[]> {
  const { data, error } = await admin
    .from('ai_runs')
    .select('input_digest, input_payload, output_text, reward, verifier_passed')
    .eq('task_type', taskType)
    .eq('verifier_passed', true)
    .not('reward', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to export preference pairs: ${error.message}`);

  const byDigest = new Map<string, Array<{ output: string; reward: number; input: unknown }>>();
  for (const run of data ?? []) {
    if (!run.input_digest || !run.output_text) continue;
    const bucket = byDigest.get(run.input_digest) ?? [];
    bucket.push({ output: run.output_text, reward: Number(run.reward), input: run.input_payload });
    byDigest.set(run.input_digest, bucket);
  }

  const pairs: PreferencePair[] = [];
  for (const runs of byDigest.values()) {
    if (runs.length < 2) continue;
    runs.sort((a, b) => b.reward - a.reward);
    const best = runs[0];
    const worst = runs[runs.length - 1];
    const margin = best.reward - worst.reward;
    if (margin < minMargin) continue;
    pairs.push({
      taskType,
      input: best.input,
      chosen: best.output,
      rejected: worst.output,
      chosenReward: best.reward,
      rejectedReward: worst.reward,
      margin,
    });
  }

  return pairs;
}

/* ─── Entry point ──────────────────────────────────────────────────────────── */

export interface LearningCycleReport {
  decisions: PromotionDecision[];
  exemplarsMined: number;
  errors: string[];
}

export async function runLearningCycle(): Promise<LearningCycleReport> {
  const admin = createAdminClient();
  if (!admin) {
    throw new Error(
      'The learning cycle needs SUPABASE_SERVICE_ROLE_KEY: promotion writes to the ' +
        'global policy tables, which are intentionally not writable by user JWTs.',
    );
  }

  const decisions: PromotionDecision[] = [];
  const errors: string[] = [];

  for (const spec of listTaskSpecs()) {
    try {
      decisions.push(...(await evaluatePromotions(admin, spec.type)));
    } catch (err) {
      // One bad task type must not stop the others from learning.
      errors.push(`${spec.type}: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  let exemplarsMined = 0;
  try {
    exemplarsMined = await mineExemplars(admin);
  } catch (err) {
    errors.push(`exemplar mining: ${err instanceof Error ? err.message : 'unknown error'}`);
  }

  return { decisions, exemplarsMined, errors };
}
