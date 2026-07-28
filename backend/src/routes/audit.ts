import { Router, type Request, type Response, type NextFunction } from 'express';
import { createUserClient } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { HttpError } from '../lib/errors.js';
import {
  auditRunCreateSchema,
  auditRunPatchSchema,
  auditRunQuerySchema,
  auditStepsSchema,
} from '../lib/validation.js';
import { AGENT_CATALOG, agentFor } from '../lib/auditCatalog.js';
import {
  finishRun,
  recordSteps,
  resolveOrgId,
  startRun,
  updateRun,
  type StepInput,
} from '../lib/auditLog.js';

/**
 * The Audit tab's API: everything every agent did, and the ordered steps that
 * produced it.
 *
 * Reads and writes both run under the caller's JWT, so RLS — not this file — is
 * what keeps one organization's trail invisible to another. What this file adds
 * on top is scoping: an org id is never accepted from the request body, only
 * resolved from the caller's membership, so a caller cannot file or fetch work
 * against an organization they do not belong to even before RLS is consulted.
 */
export const auditRouter = Router();

auditRouter.use(requireAuth);

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Reads the caller's org, or fails the request if they have not onboarded. */
async function requireOrg(req: Request): Promise<{ supabase: any; orgId: string }> {
  const supabase = createUserClient(req.accessToken!);
  const orgId = await resolveOrgId(supabase, req.user!.id);
  if (!orgId) {
    throw new HttpError(
      403,
      'Join an organization before viewing its audit trail.',
      'audit_no_org',
    );
  }
  return { supabase, orgId };
}

function serializeRun(row: any, actorEmail: string | null = null, includeBodies = false) {
  const run: Record<string, unknown> = {
    id: row.id,
    agentKey: row.agent_key,
    agent: agentFor(row.agent_key),
    agentLabel: row.agent_label ?? null,
    actorType: row.actor_type,
    actorUserId: row.actor_user_id ?? null,
    actorEmail,
    actorLabel: row.actor_label ?? null,
    parentRunId: row.parent_run_id ?? null,
    title: row.title,
    summary: row.summary ?? null,
    status: row.status,
    error: row.error ?? null,
    stepCount: row.step_count ?? 0,
    inputTokens: Number(row.input_tokens ?? 0),
    outputTokens: Number(row.output_tokens ?? 0),
    sourceTable: row.source_table ?? null,
    sourceId: row.source_id ?? null,
    startedAt: row.started_at ?? null,
    finishedAt: row.finished_at ?? null,
    durationMs: row.duration_ms ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? null,
  };
  // Inputs and results can be large. The list view never needs them; the
  // detail view always does.
  if (includeBodies) {
    run.input = row.input ?? null;
    run.result = row.result ?? null;
  }
  return run;
}

function serializeStep(row: any) {
  return {
    id: row.id,
    seq: row.seq,
    type: row.type,
    action: row.action ?? null,
    detail: row.detail ?? null,
    target: row.target ?? null,
    payload: row.payload ?? null,
    status: row.status,
    error: row.error ?? null,
    startedAt: row.started_at ?? null,
    finishedAt: row.finished_at ?? null,
    durationMs: row.duration_ms ?? null,
    createdAt: row.created_at,
  };
}

/**
 * Resolves actor ids to emails in one query.
 *
 * agent_runs.actor_user_id points at auth.users rather than profiles, so
 * PostgREST cannot embed the profile — and pointing it at profiles instead
 * would make a bridged run silently fail to mirror whenever the acting user
 * had no profile row yet. One extra lookup is the cheaper trade.
 */
async function actorEmails(supabase: any, rows: any[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((row) => row.actor_user_id).filter(Boolean))] as string[];
  if (!ids.length) return new Map();
  const { data } = await supabase.from('profiles').select('id, email').in('id', ids);
  return new Map(
    ((data ?? []) as any[])
      .filter((profile) => profile.email)
      .map((profile) => [profile.id as string, profile.email as string]),
  );
}

/**
 * GET /api/audit/agents
 * Every agent in the catalog with its running totals — including the ones that
 * have never run, so "this agent has done nothing" is distinguishable from
 * "this agent is not being audited".
 */
auditRouter.get('/agents', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, orgId } = await requireOrg(req);
    const { data, error } = await supabase.rpc('agent_audit_rollup', { p_org: orgId });
    if (error) throw new HttpError(500, error.message, 'audit_rollup_failed');

    const rollup = new Map<string, any>(
      ((data ?? []) as any[]).map((row) => [row.agent_key as string, row]),
    );
    // Catalog first, then any agent that has recorded work without a catalog
    // entry — a new agent shipping ahead of its listing still shows up.
    const keys = [
      ...AGENT_CATALOG.map((agent) => agent.key),
      ...[...rollup.keys()].filter((key) => !AGENT_CATALOG.some((agent) => agent.key === key)),
    ];

    res.json({
      agents: keys.map((key) => {
        const stats = rollup.get(key) as any;
        return {
          ...agentFor(key),
          total: Number(stats?.total ?? 0),
          succeeded: Number(stats?.succeeded ?? 0),
          failed: Number(stats?.failed ?? 0),
          active: Number(stats?.active ?? 0),
          steps: Number(stats?.steps ?? 0),
          lastRunAt: stats?.last_run_at ?? null,
          avgDurationMs: stats?.avg_duration_ms == null ? null : Number(stats.avg_duration_ms),
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/audit/stats
 * The headline numbers above the run list.
 */
auditRouter.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, orgId } = await requireOrg(req);
    const { data, error } = await supabase.rpc('agent_audit_stats', { p_org: orgId });
    if (error) throw new HttpError(500, error.message, 'audit_stats_failed');

    const row = (data?.[0] ?? {}) as any;
    res.json({
      stats: {
        totalRuns: Number(row.total_runs ?? 0),
        activeRuns: Number(row.active_runs ?? 0),
        failedRuns: Number(row.failed_runs ?? 0),
        succeededRuns: Number(row.succeeded_runs ?? 0),
        totalSteps: Number(row.total_steps ?? 0),
        inputTokens: Number(row.input_tokens ?? 0),
        outputTokens: Number(row.output_tokens ?? 0),
        runs24h: Number(row.runs_24h ?? 0),
        agentsSeen: Number(row.agents_seen ?? 0),
        lastRunAt: row.last_run_at ?? null,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/audit/runs
 * The filtered run list, newest first.
 *
 * Filtering, the actor-email join and keyset paging all happen in
 * agent_audit_runs (see db/audit_ledger.sql) — the cursor is a row comparison
 * and the join crosses into auth.users, neither of which the REST filter
 * grammar expresses well. The cursor handed back to the client is the last
 * row's "<created_at>|<id>"; the id breaks ties between runs written in the
 * same transaction, which the bridges do routinely.
 */
auditRouter.get('/runs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filters = auditRunQuerySchema.parse(req.query);
    const { supabase, orgId } = await requireOrg(req);

    let cursorAt: string | null = null;
    let cursorId: string | null = null;
    if (filters.cursor) {
      const separator = filters.cursor.lastIndexOf('|');
      cursorAt = separator > 0 ? filters.cursor.slice(0, separator) : '';
      cursorId = separator > 0 ? filters.cursor.slice(separator + 1) : '';
      if (!cursorAt || !cursorId) {
        throw new HttpError(400, 'Malformed page cursor.', 'audit_bad_cursor');
      }
    }

    // One row over the page size: its presence is what tells us there is a
    // next page, without a second count query.
    const { data, error } = await supabase.rpc('agent_audit_runs', {
      p_org: orgId,
      p_agent: filters.agent ?? null,
      p_status: filters.status ?? null,
      p_actor_type: filters.actorType ?? null,
      p_actor_user: filters.actorUserId ?? null,
      p_q: filters.q || null,
      p_from: filters.from ?? null,
      p_to: filters.to ?? null,
      p_limit: filters.limit + 1,
      p_cursor_at: cursorAt,
      p_cursor_id: cursorId,
    });
    if (error) throw new HttpError(500, error.message, 'audit_runs_failed');

    const rows = (data ?? []) as any[];
    const hasMore = rows.length > filters.limit;
    const page = hasMore ? rows.slice(0, filters.limit) : rows;
    const last = page[page.length - 1];

    res.json({
      runs: page.map((row) => serializeRun(row, row.actor_email ?? null)),
      nextCursor: hasMore && last ? `${last.created_at}|${last.id}` : null,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/audit/runs/:id
 * One run and its trace.
 *
 * Steps are paged on `afterSeq` so the detail view can tail a running agent by
 * asking only for what it has not already drawn, instead of refetching a trace
 * that grows for the length of the run.
 */
auditRouter.get('/runs/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, orgId } = await requireOrg(req);
    const runId = req.params.id;

    const { data: runRow, error: runErr } = await supabase
      .from('agent_runs')
      .select('*')
      .eq('id', runId)
      .eq('org_id', orgId)
      .maybeSingle();
    if (runErr) throw new HttpError(500, runErr.message, 'audit_run_failed');
    if (!runRow) throw new HttpError(404, 'That run is not in this audit trail.', 'audit_run_not_found');

    const afterSeq = Number(req.query.afterSeq ?? 0) || 0;
    const stepLimit = Math.min(Math.max(Number(req.query.stepLimit ?? 500) || 500, 1), 1000);

    let stepQuery = supabase
      .from('agent_run_steps')
      .select('*')
      .eq('run_id', runId)
      .order('seq', { ascending: true })
      .limit(stepLimit + 1);
    if (afterSeq > 0) stepQuery = stepQuery.gt('seq', afterSeq);

    const { data: stepRows, error: stepErr } = await stepQuery;
    if (stepErr) throw new HttpError(500, stepErr.message, 'audit_steps_failed');

    const steps = (stepRows ?? []) as any[];
    const moreSteps = steps.length > stepLimit;
    const page = moreSteps ? steps.slice(0, stepLimit) : steps;

    const emails = await actorEmails(supabase, [runRow]);
    res.json({
      run: serializeRun(runRow, emails.get(runRow.actor_user_id) ?? null, true),
      steps: page.map(serializeStep),
      moreSteps,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/audit/runs
 * Opens a run. Used by agents that run outside this process; agents inside it
 * call lib/auditLog.ts directly and skip the HTTP hop.
 */
auditRouter.post('/runs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = auditRunCreateSchema.parse(req.body);
    const { supabase, orgId } = await requireOrg(req);

    const created = await startRun(supabase, {
      orgId,
      agentKey: body.agentKey,
      title: body.title,
      agentLabel: body.agentLabel ?? null,
      actorType: body.actorType ?? 'user',
      actorUserId: body.actorType && body.actorType !== 'user' ? null : req.user!.id,
      actorLabel: body.actorLabel ?? null,
      parentRunId: body.parentRunId ?? null,
      status: body.status ?? 'running',
      input: body.input,
      startedAt: body.startedAt ?? null,
    });
    if (!created.ok || !created.data) {
      throw new HttpError(500, created.error ?? 'Could not open the run.', 'audit_start_failed');
    }

    if (body.steps?.length) {
      await recordSteps(supabase, created.data.id, body.steps as StepInput[]);
    }

    res.status(201).json({ runId: created.data.id });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/audit/runs/:id/steps
 * Appends to a run's trace. Steps are immutable once written; this is the only
 * way the trace ever changes.
 */
auditRouter.post('/runs/:id/steps', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { steps } = auditStepsSchema.parse(req.body);
    const { supabase, orgId } = await requireOrg(req);
    const runId = req.params.id;

    // Confirms the run is in the caller's org before writing. RLS would reject
    // a foreign run anyway, but as an opaque failure rather than a clear 404.
    const { data: run, error } = await supabase
      .from('agent_runs')
      .select('id')
      .eq('id', runId)
      .eq('org_id', orgId)
      .maybeSingle();
    if (error) throw new HttpError(500, error.message, 'audit_run_failed');
    if (!run) throw new HttpError(404, 'That run is not in this audit trail.', 'audit_run_not_found');

    const written = await recordSteps(supabase, runId, steps as StepInput[]);
    if (!written.ok) {
      throw new HttpError(500, written.error ?? 'Could not record the steps.', 'audit_step_failed');
    }
    res.status(201).json({ steps: written.data ?? [] });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/audit/runs/:id
 * Reports progress or closes a run. A terminal run refuses to be re-decided —
 * the database enforces it, and that refusal surfaces here as a 409 rather than
 * a 500, because it is a statement about the ledger, not a fault.
 */
auditRouter.patch('/runs/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = auditRunPatchSchema.parse(req.body);
    const { supabase, orgId } = await requireOrg(req);
    const runId = req.params.id;

    const { data: run, error } = await supabase
      .from('agent_runs')
      .select('id, status')
      .eq('id', runId)
      .eq('org_id', orgId)
      .maybeSingle();
    if (error) throw new HttpError(500, error.message, 'audit_run_failed');
    if (!run) throw new HttpError(404, 'That run is not in this audit trail.', 'audit_run_not_found');

    const terminal = body.status && ['succeeded', 'failed', 'cancelled'].includes(body.status);
    const outcome = terminal
      ? await finishRun(supabase, runId, {
          status: body.status!,
          summary: body.summary ?? undefined,
          result: body.result,
          error: body.error ?? undefined,
          inputTokens: body.inputTokens,
          outputTokens: body.outputTokens,
          finishedAt: body.finishedAt ?? undefined,
        })
      : await updateRun(supabase, runId, {
          status: body.status,
          summary: body.summary ?? undefined,
          inputTokens: body.inputTokens,
          outputTokens: body.outputTokens,
        });

    if (!outcome.ok) {
      const alreadyDecided = /outcome cannot be changed|immutable|cannot decrease/i.test(
        outcome.error ?? '',
      );
      throw new HttpError(
        alreadyDecided ? 409 : 500,
        alreadyDecided
          ? `This run is already ${run.status}; a recorded outcome cannot be rewritten.`
          : (outcome.error ?? 'Could not update the run.'),
        alreadyDecided ? 'audit_run_final' : 'audit_update_failed',
      );
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
