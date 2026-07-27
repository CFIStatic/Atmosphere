import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { estimateCostUsd, lookupModel, tierPrior } from './catalog.js';
import { buildPrompt } from './prompt.js';
import { contextKeys, primaryContextKey, selectArm, sizeBucketFor } from './policy.js';
import { getProvider, isProviderConfigured, ProviderError } from './providers/index.js';
import { provisionalReward } from './reward.js';
import { loadArms, loadExemplars, loadStats, recordRun } from './store.js';
import { getTaskSpec } from './taskTypes.js';
import { verify } from './verifiers.js';
import type { Arm, ExecutionResult, TaskContext, TaskType } from './types.js';

/**
 * The execution loop — one turn of the cycle the whole branch is about:
 *
 *     route → execute → verify → score → record → (later) learn
 *
 * Read the ordering as a set of guarantees:
 *
 *  • **The user never eats an experiment.** If an explored arm produces output
 *    that fails a fatal check, the run is still *recorded* (that failure is real
 *    evidence about that arm) and then the champion is run to produce what the
 *    user actually receives. Exploration costs us money and latency; it does not
 *    cost the user a wrong answer.
 *
 *  • **Infrastructure noise never becomes a quality signal.** A timeout, a 503
 *    or a rejected model id fails over *without* recording a reward. Otherwise a
 *    vendor's bad afternoon would teach the policy to abandon a good model, and
 *    the loop would slowly converge on whoever had the best uptime rather than
 *    the best output.
 *
 *  • **Every run is recorded, not just the interesting ones.** Explicit human
 *    feedback is rare; if we only learned from rated runs we would be learning
 *    the preferences of the handful of people who click things.
 */

export interface ExecuteInput {
  supabase: SupabaseClient;
  orgId: string;
  userId: string;
  taskType: TaskType;
  input: unknown;
  /** Mitigation vs construction — part of the routing context. */
  workType?: string;
}

/** Bounded so a single request cannot chain failovers indefinitely. */
const MAX_ATTEMPTS = 3;

export async function executeTask(params: ExecuteInput): Promise<ExecutionResult> {
  const spec = getTaskSpec(params.taskType);

  // Validate before spending a single token — a malformed request is our bug or
  // the caller's, and must never reach an arm where it would be scored as one.
  const parsedInput = spec.inputSchema.safeParse(params.input);
  if (!parsedInput.success) {
    throw new TaskInputError(
      parsedInput.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
    );
  }
  const input = parsedInput.data;

  const context: TaskContext = {
    taskType: params.taskType,
    orgId: params.orgId,
    userId: params.userId,
    workType: params.workType,
    sizeBucket: sizeBucketFor(input),
  };

  const arms = await loadArms(params.supabase, params.taskType);
  const stats = await loadStats(
    params.supabase,
    params.taskType,
    arms.map((arm) => arm.id),
  );

  const selection = selectArm({ spec, context, arms, stats });
  const exemplars = await loadExemplars(
    params.supabase,
    params.orgId,
    params.taskType,
    config.ai.learning.maxExemplars,
  );

  const champion = arms.find((arm) => arm.status === 'champion' && isProviderConfigured(arm.provider));
  const attempts = attemptOrder(selection.arm, champion, arms);

  const failures: string[] = [];

  for (let i = 0; i < attempts.length && i < MAX_ATTEMPTS; i += 1) {
    const arm = attempts[i];
    const explored = i === 0 ? selection.explored : false;
    const reason = i === 0 ? selection.reason : `failover after: ${failures[failures.length - 1]}`;

    let attempt: AttemptOutcome;
    try {
      attempt = await runArm(spec, arm, input, exemplars);
    } catch (err) {
      // Transport-level failure. No reward is recorded — see the header note.
      const message = err instanceof Error ? err.message : 'unknown provider error';
      failures.push(message);
      console.warn(`[ai] arm ${arm.id} (${arm.provider}/${arm.model}) failed: ${message}`);
      continue;
    }

    // The model answered. Whatever it said is evidence about this arm, so the
    // episode is recorded before we decide whether it is servable.
    const runId = await recordAttempt({
      supabase: params.supabase,
      spec,
      arm,
      context,
      input,
      attempt,
      explored,
      selectionReason: reason,
      mode: 'serve',
    });

    if (!attempt.verifier.passed) {
      const detail = attempt.verifier.checks
        .filter((c) => !c.passed)
        .map((c) => c.name)
        .join(', ');
      failures.push(`verifier rejected output from ${arm.provider}/${arm.model} (${detail})`);
      console.warn(`[ai] run ${runId} failed verification: ${detail}`);
      continue;
    }

    return {
      runId,
      output: attempt.output,
      raw: attempt.text,
      arm: { id: arm.id, provider: arm.provider, model: arm.model, promptVariant: arm.promptVariant },
      verifier: attempt.verifier,
      costUsd: attempt.costUsd,
      latencyMs: attempt.latencyMs,
      explored,
    };
  }

  throw new TaskExecutionError(
    `Could not produce a verified result for ${params.taskType}`,
    failures,
  );
}

/**
 * Which arms to try, in order.
 *
 * The champion is always the first fallback: when an experiment does not work
 * out, the user should land on the best thing we know, not on another
 * experiment. Remaining arms follow only as a last resort before failing.
 */
function attemptOrder(selected: Arm, champion: Arm | undefined, arms: Arm[]): Arm[] {
  const order: Arm[] = [selected];
  if (champion && champion.id !== selected.id) order.push(champion);
  for (const arm of arms) {
    if (arm.status === 'retired') continue;
    if (!isProviderConfigured(arm.provider)) continue;
    if (order.some((existing) => existing.id === arm.id)) continue;
    order.push(arm);
  }
  return order;
}

interface AttemptOutcome {
  text: string;
  output: unknown;
  verifier: ReturnType<typeof verify>['result'];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

/** Exported for the offline evaluator, which replays golden cases through arms. */
export async function runArm(
  spec: ReturnType<typeof getTaskSpec>,
  arm: Arm,
  input: unknown,
  exemplars: Awaited<ReturnType<typeof loadExemplars>>,
): Promise<AttemptOutcome> {
  const provider = getProvider(arm.provider);
  const prompt = buildPrompt(spec, arm.promptVariant, input, exemplars);

  // A hung vendor must not pin the request open; failing over is cheaper than
  // waiting. AbortSignal.timeout also frees the socket, not just the promise.
  const signal = AbortSignal.timeout(config.ai.requestTimeoutMs);
  const startedAt = Date.now();

  const completion = await provider.complete({
    model: arm.model,
    system: prompt.system,
    messages: prompt.messages,
    maxOutputTokens: arm.maxOutputTokens ?? spec.maxOutputTokens,
    temperature: arm.temperature,
    json: spec.json,
    signal,
  });

  const latencyMs = Date.now() - startedAt;
  const { result, output } = verify(spec, completion.text, input);

  return {
    text: completion.text,
    output,
    verifier: result,
    inputTokens: completion.inputTokens,
    outputTokens: completion.outputTokens,
    costUsd: estimateCostUsd(arm.provider, arm.model, completion.inputTokens, completion.outputTokens),
    latencyMs,
  };
}

interface RecordAttemptInput {
  supabase: SupabaseClient;
  spec: ReturnType<typeof getTaskSpec>;
  arm: Arm;
  context: TaskContext;
  input: unknown;
  attempt: AttemptOutcome;
  explored: boolean;
  selectionReason: string;
  mode: 'serve' | 'shadow';
}

async function recordAttempt(params: RecordAttemptInput): Promise<string> {
  const { spec, arm, context, input, attempt } = params;

  const breakdown = provisionalReward({
    spec,
    verifierScore: attempt.verifier.score,
    costUsd: attempt.costUsd,
    latencyMs: attempt.latencyMs,
  });

  const prior = tierPrior(lookupModel(arm.provider, arm.model)?.tier ?? 'fast');

  return recordRun(params.supabase, {
    orgId: context.orgId,
    taskType: context.taskType,
    contextKey: primaryContextKey(context),
    contextKeys: contextKeys(context),
    armId: arm.id,
    provider: arm.provider,
    model: arm.model,
    promptVariant: arm.promptVariant,
    mode: params.mode,
    explored: params.explored,
    selectionReason: params.selectionReason,
    inputDigest: digest(input),
    inputPayload: input,
    outputText: attempt.text,
    inputTokens: attempt.inputTokens,
    outputTokens: attempt.outputTokens,
    costUsd: attempt.costUsd,
    latencyMs: attempt.latencyMs,
    verifierScore: attempt.verifier.score,
    verifierPassed: attempt.verifier.passed,
    verifierDetail: { checks: attempt.verifier.checks, reward: breakdown },
    reward: breakdown.reward,
    alphaPrior: prior.alpha,
    betaPrior: prior.beta,
  });
}

/**
 * Shadow execution: run an arm, score it, record it, serve nothing.
 *
 * This is how challengers earn promotion on high-stakes tasks, where live
 * exploration is not acceptable. It costs a duplicate model call and buys a
 * completely risk-free comparison against the champion on real production
 * inputs — which is a far better signal than any static test set, because it is
 * the actual distribution of work walking through the door.
 *
 * Fire-and-forget by design: a shadow run must never add latency to, or be able
 * to fail, the request the user is waiting on.
 */
export function runShadow(params: ExecuteInput & { arm: Arm }): void {
  const spec = getTaskSpec(params.taskType);
  const parsed = spec.inputSchema.safeParse(params.input);
  if (!parsed.success) return;

  const context: TaskContext = {
    taskType: params.taskType,
    orgId: params.orgId,
    userId: params.userId,
    workType: params.workType,
    sizeBucket: sizeBucketFor(parsed.data),
  };

  void (async () => {
    try {
      const exemplars = await loadExemplars(
        params.supabase,
        params.orgId,
        params.taskType,
        config.ai.learning.maxExemplars,
      );
      const attempt = await runArm(spec, params.arm, parsed.data, exemplars);
      await recordAttempt({
        supabase: params.supabase,
        spec,
        arm: params.arm,
        context,
        input: parsed.data,
        attempt,
        explored: true,
        selectionReason: 'shadow evaluation',
        mode: 'shadow',
      });
    } catch (err) {
      console.warn(`[ai] shadow run failed: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  })();
}

/** Content hash of an input, for dedupe and replay without re-storing it. */
function digest(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input) ?? '').digest('hex');
}

export class TaskInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskInputError';
  }
}

export class TaskExecutionError extends Error {
  public readonly failures: string[];
  constructor(message: string, failures: string[]) {
    super(message);
    this.name = 'TaskExecutionError';
    this.failures = failures;
  }
}

export { ProviderError };
