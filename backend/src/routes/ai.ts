import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { catalog } from '../ai/catalog.js';
import { configuredProviders } from '../ai/providers/index.js';
import { executeTask, previewRoute, TaskExecutionError, TaskInputError } from '../ai/executor.js';
import { posteriorMean } from '../ai/policy.js';
import { computeReward, dispositionFromEdit, editRatio as computeEditRatio } from '../ai/reward.js';
import { getCallerOrgId, getRun, resolveRun } from '../ai/store.js';
import { getTaskSpec, listTaskSpecs, TASK_TYPES } from '../ai/taskTypes.js';
import type { Disposition, TaskType } from '../ai/types.js';
import { createUserClient } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import { requireAuth } from '../middleware/requireAuth.js';

export const aiRouter = Router();

aiRouter.use(requireAuth);

/**
 * Model calls cost real money, so the execution endpoint is rate limited far
 * more tightly than ordinary reads. This is a per-IP backstop against a runaway
 * client; per-org spend caps belong in a billing layer, not here.
 */
const runLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many task runs, slow down.', code: 'rate_limited' } },
});

const taskTypeSchema = z.enum(TASK_TYPES);

const runSchema = z.object({
  // Validated loosely here; the task spec applies the real schema in the
  // executor, so a task's contract lives in exactly one place.
  input: z.unknown(),
  workType: z.enum(['mitigation', 'construction']).optional(),
});

/**
 * Feedback on a run. Either an explicit disposition, or the text the user
 * actually saved — from which we derive how much they had to change.
 *
 * The edited-text path is by far the better signal: it is a by-product of doing
 * the job rather than a rating someone had to be nagged into leaving, so it
 * arrives for a large share of runs and it cannot be gamed by habit-clicking.
 */
const feedbackSchema = z
  .object({
    disposition: z.enum(['accepted', 'edited_minor', 'edited_major', 'rejected', 'failed']).optional(),
    editedOutput: z.string().max(100_000).optional(),
  })
  .refine((value) => value.disposition || value.editedOutput !== undefined, {
    message: 'Provide a disposition or the edited output',
  });

/** Resolve the caller's org, or explain why the task cannot run. */
async function requireOrgId(req: Request): Promise<{ supabase: ReturnType<typeof createUserClient>; orgId: string }> {
  const supabase = createUserClient(req.accessToken!);
  const orgId = await getCallerOrgId(supabase, req.user!.id);
  if (!orgId) {
    throw new HttpError(409, 'Finish onboarding before running tasks.', 'no_organization');
  }
  return { supabase, orgId };
}

/**
 * GET /api/ai/tasks
 * The task catalog — what the platform knows how to do, and how each kind of
 * work is judged. Exposed so the UI can render it without duplicating the spec.
 */
aiRouter.get('/tasks', (_req: Request, res: Response) => {
  res.json({
    tasks: listTaskSpecs().map((spec) => ({
      type: spec.type,
      description: spec.description,
      rewardWeights: spec.rewardWeights,
      costBudgetUsd: spec.costBudgetUsd,
      latencyBudgetMs: spec.latencyBudgetMs,
      highStakes: Boolean(spec.highStakes),
      checks: spec.checks.map((check) => ({ name: check.name, fatal: Boolean(check.fatal) })),
    })),
  });
});

/**
 * GET /api/ai/providers
 * Which LLM APIs are configured right now, and the models the router can send
 * work to. An unset API key simply drops that vendor from the pool.
 */
aiRouter.get('/providers', (_req: Request, res: Response) => {
  const configured = new Set(configuredProviders());
  res.json({
    providers: (['openai', 'anthropic', 'google', 'xai', 'oss'] as const).map((id) => ({
      id,
      configured: configured.has(id),
      models: catalog
        .filter((entry) => entry.provider === id)
        .map((entry) => ({
          key: entry.key,
          model: entry.model,
          tier: entry.tier,
          contextWindow: entry.contextWindow,
        })),
    })),
  });
});

/**
 * POST /api/ai/tasks/:taskType/route
 * Assess complexity and preview which provider/model would run — without
 * calling any LLM. Useful for operators and for clients that want to show the
 * routing decision before spending tokens.
 */
aiRouter.post('/tasks/:taskType/route', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const taskType = taskTypeSchema.parse(req.params.taskType) as TaskType;
    const { input, workType } = runSchema.parse(req.body);
    const { supabase, orgId } = await requireOrgId(req);

    const preview = await previewRoute({
      supabase,
      orgId,
      userId: req.user!.id,
      taskType,
      input,
      workType,
    });

    res.json(preview);
  } catch (err) {
    if (err instanceof TaskInputError) {
      next(new HttpError(400, err.message, 'invalid_task_input'));
      return;
    }
    next(err);
  }
});

/**
 * POST /api/ai/tasks/:taskType/run
 * Execute a unit of work. The response carries `runId` — the client must send
 * it back with feedback, which is what closes the learning loop.
 */
aiRouter.post('/tasks/:taskType/run', runLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const taskType = taskTypeSchema.parse(req.params.taskType) as TaskType;
    const { input, workType } = runSchema.parse(req.body);
    const { supabase, orgId } = await requireOrgId(req);

    const result = await executeTask({
      supabase,
      orgId,
      userId: req.user!.id,
      taskType,
      input,
      workType,
    });

    res.json({
      runId: result.runId,
      output: result.output,
      // Surfaced deliberately. A user who can see which model produced a draft
      // — and that it was an experiment — gives far better feedback than one
      // shown an anonymous answer from a black box.
      execution: {
        provider: result.arm.provider,
        model: result.arm.model,
        promptVariant: result.arm.promptVariant,
        explored: result.explored,
        selectionReason: result.selectionReason,
        verifierScore: Number(result.verifier.score.toFixed(3)),
        costUsd: Number(result.costUsd.toFixed(6)),
        latencyMs: result.latencyMs,
      },
      assessment: result.assessment,
    });
  } catch (err) {
    if (err instanceof TaskInputError) {
      next(new HttpError(400, err.message, 'invalid_task_input'));
      return;
    }
    if (err instanceof TaskExecutionError) {
      // Every arm failed or was rejected by the verifier. 502 rather than 500:
      // the fault is upstream, and the distinction matters when reading logs.
      next(new HttpError(502, err.message, 'task_execution_failed'));
      return;
    }
    next(err);
  }
});

/**
 * POST /api/ai/runs/:runId/feedback
 * Attach the human signal to a run and rescore it. Idempotent — re-submitting
 * replaces the previous verdict rather than counting a second observation.
 */
aiRouter.post('/runs/:runId/feedback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const runId = z.string().uuid('Invalid run id').parse(req.params.runId);
    const body = feedbackSchema.parse(req.body);
    const supabase = createUserClient(req.accessToken!);

    // RLS already scopes this to the caller's org — a run from another org
    // simply is not visible, so this reads as "not found" rather than "denied".
    const run = await getRun(supabase, runId);
    if (!run) throw new HttpError(404, 'Run not found', 'run_not_found');

    let disposition: Disposition;
    let ratio: number | null = null;

    if (body.editedOutput !== undefined) {
      ratio = computeEditRatio(run.output_text ?? '', body.editedOutput);
      disposition = body.disposition ?? dispositionFromEdit(ratio);
    } else {
      disposition = body.disposition as Disposition;
    }

    const spec = getTaskSpec(run.task_type as TaskType);
    const breakdown = computeReward({
      spec,
      verifierScore: Number(run.verifier_score ?? 0),
      disposition,
      editRatio: ratio,
      costUsd: Number(run.cost_usd ?? 0),
      latencyMs: Number(run.latency_ms ?? 0),
    });

    await resolveRun(supabase, runId, disposition, ratio, breakdown.reward);

    res.json({
      runId,
      disposition,
      editRatio: ratio === null ? null : Number(ratio.toFixed(3)),
      reward: Number(breakdown.reward.toFixed(4)),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/ai/policy
 * What the platform has learned so far: every arm, its posterior, and what it
 * costs. This is the observability surface for the whole branch — if you cannot
 * see why the router prefers an arm, you cannot trust it to keep choosing.
 */
aiRouter.get('/policy', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);

    const { data: arms, error: armErr } = await supabase
      .from('ai_arms')
      .select('id, task_type, provider, model, prompt_variant, status, promoted_at')
      .neq('status', 'retired')
      .order('task_type', { ascending: true });
    if (armErr) throw new HttpError(500, armErr.message, 'policy_read_failed');

    const { data: stats, error: statsErr } = await supabase
      .from('ai_arm_stats')
      .select('arm_id, context_key, trials, alpha, beta, avg_cost_usd, avg_latency_ms');
    if (statsErr) throw new HttpError(500, statsErr.message, 'policy_read_failed');

    const statsByArm = new Map<string, Array<Record<string, unknown>>>();
    for (const row of stats ?? []) {
      const bucket = statsByArm.get(row.arm_id) ?? [];
      bucket.push(row);
      statsByArm.set(row.arm_id, bucket);
    }

    res.json({
      providers: configuredProviders(),
      arms: (arms ?? []).map((arm) => {
        const rows = statsByArm.get(arm.id) ?? [];
        // Report the task-level row — the same evidence the promotion gate uses.
        const overall = rows.find((row) => row.context_key === arm.task_type);
        return {
          id: arm.id,
          taskType: arm.task_type,
          provider: arm.provider,
          model: arm.model,
          promptVariant: arm.prompt_variant,
          status: arm.status,
          promotedAt: arm.promoted_at,
          trials: overall ? Number(overall.trials) : 0,
          meanReward: overall
            ? Number(posteriorMean(Number(overall.alpha), Number(overall.beta)).toFixed(4))
            : null,
          avgCostUsd: overall ? Number(Number(overall.avg_cost_usd).toFixed(6)) : null,
          avgLatencyMs: overall ? Math.round(Number(overall.avg_latency_ms)) : null,
          byContext: rows
            .filter((row) => row.context_key !== arm.task_type)
            .map((row) => ({
              contextKey: row.context_key,
              trials: Number(row.trials),
              meanReward: Number(posteriorMean(Number(row.alpha), Number(row.beta)).toFixed(4)),
            })),
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/ai/runs
 * Recent episodes for the caller's org — the audit trail behind every number on
 * the policy page.
 */
aiRouter.get('/runs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    const supabase = createUserClient(req.accessToken!);

    let query = supabase
      .from('ai_runs')
      .select('id, task_type, provider, model, prompt_variant, mode, explored, verifier_score, cost_usd, latency_ms, reward, reward_status, disposition, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    const taskType = req.query.taskType;
    if (typeof taskType === 'string' && taskType) {
      query = query.eq('task_type', taskTypeSchema.parse(taskType));
    }

    const { data, error } = await query;
    if (error) throw new HttpError(500, error.message, 'runs_read_failed');

    res.json({ runs: data ?? [] });
  } catch (err) {
    next(err);
  }
});
