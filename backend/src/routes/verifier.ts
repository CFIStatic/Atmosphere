import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { config, verifierEnabled } from '../config.js';
import { createUserClient } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { HttpError } from '../lib/errors.js';
import { resolveEscalationSchema } from '../lib/validation.js';
import {
  enqueueVerification,
  pendingVerificationCount,
  resolveEscalation,
} from '../lib/verifierRunner.js';
import { hasRunCapacity, type ConnectionRecord } from '../lib/webRunner.js';

/**
 * Verifier — the checks made on Web Access runs, and the questions raised when
 * a check could not settle itself.
 *
 * Org-scoped through the caller's JWT like everything else. Note that reading a
 * verification is intentionally open to the whole organization rather than to
 * whoever started the run: the escalation queue only works if anyone on shift
 * can answer it, and a question that only one person can see is a question that
 * waits for them to come back from holiday.
 */

export const verifierRouter = Router();

/* eslint-disable @typescript-eslint/no-explicit-any */

verifierRouter.use(requireAuth);

/** A check costs a browser and several model calls, the same as a run. */
const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many checks started. Wait a few minutes and try again.', code: 'rate_limited' },
});

const VERIFICATION_COLUMNS =
  'id, run_id, connection_id, status, verdict, expectations, findings, steps, repair_attempts, summary, error, started_at, finished_at, created_at';

const ESCALATION_COLUMNS =
  'id, verification_id, run_id, reason, question, context, options, status, chosen_option, resolution_note, resolved_by, resolved_at, created_at';

function serializeVerification(row: any) {
  return {
    id: row.id,
    runId: row.run_id,
    connectionId: row.connection_id,
    status: row.status,
    verdict: row.verdict ?? null,
    expectations: row.expectations ?? [],
    findings: row.findings ?? [],
    steps: row.steps ?? [],
    repairAttempts: row.repair_attempts ?? 0,
    summary: row.summary ?? null,
    error: row.error ?? null,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  };
}

function serializeEscalation(row: any) {
  return {
    id: row.id,
    verificationId: row.verification_id,
    runId: row.run_id,
    reason: row.reason,
    question: row.question,
    context: row.context ?? {},
    options: row.options ?? [],
    status: row.status,
    chosenOption: row.chosen_option ?? null,
    resolutionNote: row.resolution_note ?? null,
    resolvedBy: row.resolved_by ?? null,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
  };
}

function requireEnabled(): void {
  if (!verifierEnabled) {
    throw new HttpError(
      503,
      'The verifier is not configured on this server.',
      'verifier_unconfigured',
    );
  }
}

/**
 * GET /api/verifier/status
 * Whether checks are running here, so the UI can say so plainly instead of
 * leaving a run looking permanently unchecked.
 */
verifierRouter.get('/status', (_req: Request, res: Response) => {
  res.json({
    enabled: verifierEnabled,
    autoVerify: verifierEnabled && config.verifier.autoVerify,
    verifyPulls: config.verifier.verifyPulls,
    maxRepairAttempts: config.verifier.maxRepairAttempts,
    pending: pendingVerificationCount(),
    capacityAvailable: hasRunCapacity(),
  });
});

/**
 * GET /api/verifier/verifications
 * Recent checks for the caller's organization, newest first. `?runId=` narrows
 * it to one run, which is what the run detail view asks for.
 */
verifierRouter.get('/verifications', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    let query = supabase
      .from('web_verifications')
      .select(VERIFICATION_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(25);

    const runId = typeof req.query.runId === 'string' ? req.query.runId : undefined;
    if (runId) query = query.eq('run_id', runId);

    const { data, error } = await query;
    if (error) throw new HttpError(500, error.message, 'verifier_list_failed');
    res.json({ verifications: (data ?? []).map(serializeVerification) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/verifier/verifications/:id
 * One check with its findings and trace. Polled while it is in flight.
 */
verifierRouter.get('/verifications/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const { data, error } = await supabase
      .from('web_verifications')
      .select(VERIFICATION_COLUMNS)
      .eq('id', req.params.id)
      .maybeSingle();

    if (error) throw new HttpError(500, error.message, 'verifier_read_failed');
    if (!data) throw new HttpError(404, 'That check no longer exists.', 'verifier_not_found');
    res.json({ verification: serializeVerification(data) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/verifier/runs/:runId/verify
 * Check a run by hand — a re-check after fixing something at the far end, or a
 * first check on a server where automatic verification is switched off.
 */
verifierRouter.post(
  '/runs/:runId/verify',
  verifyLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      requireEnabled();
      const supabase = createUserClient(req.accessToken!);

      const { data: run, error: runError } = await supabase
        .from('web_runs')
        .select('id, connection_id, status')
        .eq('id', req.params.runId)
        .maybeSingle();

      if (runError) throw new HttpError(500, runError.message, 'verifier_run_read_failed');
      if (!run) throw new HttpError(404, 'That run no longer exists.', 'verifier_not_found');
      if (run.status === 'queued' || run.status === 'running') {
        throw new HttpError(
          409,
          'That run has not finished yet. Check it once it is done.',
          'verifier_run_unfinished',
        );
      }

      const { data: connection, error: connectionError } = await supabase
        .from('web_connections')
        .select('id, org_id, label, site_url, login_url, username')
        .eq('id', run.connection_id)
        .maybeSingle();

      if (connectionError) {
        throw new HttpError(500, connectionError.message, 'verifier_connection_read_failed');
      }
      if (!connection) {
        throw new HttpError(404, 'That connection no longer exists.', 'verifier_not_found');
      }

      const verificationId = await enqueueVerification({
        accessToken: req.accessToken!,
        runId: run.id,
        connection: connection as ConnectionRecord,
        requestedBy: req.user!.id,
      });

      if (!verificationId) {
        throw new HttpError(
          409,
          'A check is already running for this run.',
          'verifier_already_running',
        );
      }

      res.status(202).json({ verificationId });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/verifier/escalations
 * The questions waiting on a person. Defaults to the open ones — that is the
 * queue the dashboard shows. `?status=all` includes answered ones.
 */
verifierRouter.get('/escalations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    let query = supabase
      .from('web_escalations')
      .select(ESCALATION_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(50);

    if (req.query.status !== 'all') query = query.eq('status', 'open');

    const { data, error } = await query;
    if (error) throw new HttpError(500, error.message, 'verifier_escalations_failed');
    res.json({ escalations: (data ?? []).map(serializeEscalation) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/verifier/escalations/:id/resolve
 * Answer a question. Accepting or rejecting closes the check on the person's
 * authority; asking for a correction or another look queues a fresh pass.
 */
verifierRouter.post(
  '/escalations/:id/resolve',
  verifyLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      requireEnabled();
      const input = resolveEscalationSchema.parse(req.body);
      const result = await resolveEscalation({
        accessToken: req.accessToken!,
        userId: req.user!.id,
        escalationId: req.params.id,
        optionId: input.optionId,
        note: input.note,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);
