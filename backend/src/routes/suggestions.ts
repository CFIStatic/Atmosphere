/**
 * Suggested work — workspace members only (requireOrgContext). Homeowners
 * and subs on a job grant are not members, so every route here is a 403 for
 * them, and every lookup filters on the caller's org (another org's id is a 404).
 *
 *   GET  /api/suggestions?jobId=           open suggestions (the queue, or one job's)
 *   POST /api/suggestions/:id/approve      { prompt? } → { suggestion, prompt } for Chat
 *   POST /api/suggestions/:id/dismiss      { reason? }
 *   POST /api/suggestions/jobs/:jobId/evaluate   look at the job again now
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireOrgContext } from '../lib/orgContext.js';
import { requireAdmin } from '../lib/scopedAdmin.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { decideSuggestion, evaluateJobSuggestions, listOpenSuggestions } from '../suggestions/store.js';
import { HttpError } from '../lib/errors.js';

export const suggestionsRouter = Router();
suggestionsRouter.use(requireAuth);

const uuid = z.string().uuid();

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    await fn(req, res);
  } catch (err) {
    next(err);
  }
};

function idParam(raw: unknown): string {
  const parsed = uuid.safeParse(raw);
  if (!parsed.success) throw new HttpError(404, 'Not found', 'not_found');
  return parsed.data;
}

suggestionsRouter.get(
  '/',
  wrap(async (req, res) => {
    const { orgId } = await requireOrgContext(req);
    const jobId = typeof req.query.jobId === 'string' && req.query.jobId ? idParam(req.query.jobId) : null;
    res.setHeader('Cache-Control', 'no-store');
    res.json({ suggestions: await listOpenSuggestions(requireAdmin(), { orgId, jobId }) });
  }),
);

suggestionsRouter.post(
  '/:id/approve',
  wrap(async (req, res) => {
    const { orgId, userId } = await requireOrgContext(req);
    const { prompt } = z.object({ prompt: z.string().trim().max(4000).optional().nullable() }).parse(req.body ?? {});
    res.json(
      await decideSuggestion(requireAdmin(), {
        orgId,
        userId,
        suggestionId: idParam(req.params.id),
        decision: 'approve',
        editedPrompt: prompt ?? null,
      }),
    );
  }),
);

suggestionsRouter.post(
  '/:id/dismiss',
  wrap(async (req, res) => {
    const { orgId, userId } = await requireOrgContext(req);
    const { reason } = z.object({ reason: z.string().trim().max(300).optional().nullable() }).parse(req.body ?? {});
    const { suggestion } = await decideSuggestion(requireAdmin(), {
      orgId,
      userId,
      suggestionId: idParam(req.params.id),
      decision: 'dismiss',
      reason: reason ?? null,
    });
    res.json({ suggestion });
  }),
);

suggestionsRouter.post(
  '/jobs/:jobId/evaluate',
  wrap(async (req, res) => {
    const { orgId } = await requireOrgContext(req);
    const jobId = idParam(req.params.jobId);
    const admin = requireAdmin();
    const result = await evaluateJobSuggestions(admin, { orgId, jobId, trigger: 'manual' });
    if (result.skipped === 'job_not_found') throw new HttpError(404, 'No such job.', 'job_not_found');
    res.json({ result, suggestions: await listOpenSuggestions(admin, { orgId, jobId }) });
  }),
);
