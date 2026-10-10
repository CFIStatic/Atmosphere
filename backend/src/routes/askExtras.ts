/**
 * Chat extras for office members on a job file: rate an answer, pin it for the
 * team, and search past chats. Mounted on sharedJobsRouter (requireAuth).
 */
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { requireOrgContext } from '../lib/orgContext.js';
import { requireAdmin, unscopedAdminOrNull } from '../lib/scopedAdmin.js';
import { approvePendingAction, denyPendingAction, getPendingAction, revokeWith } from '../shared/askApprovals.js';
import {
  FEEDBACK_REASONS,
  listPinnedAnswers,
  myFeedback,
  pinAnswer,
  rateAnswer,
  searchAskHistory,
  unpinAnswer,
} from '../shared/askAnswerExtras.js';

const uuid = z.string().uuid();

/** POST /api/operations/shared/:jobId/ask/questions/:questionId/feedback  { rating: 1 | -1 | 0, reason?, comment? } */
export async function rateAskAnswer(req: Request, res: Response, next: NextFunction) {
  try {
    const { orgId, userId, supabase } = await requireOrgContext(req);
    const input = z
      .object({
        rating: z.union([z.literal(1), z.literal(-1), z.literal(0)]),
        reason: z.enum(FEEDBACK_REASONS).optional().nullable(),
        comment: z.string().trim().max(1000).optional().nullable(),
      })
      .parse(req.body ?? {});
    const feedback = await rateAnswer(supabase, {
      orgId,
      jobId: uuid.parse(req.params.jobId),
      questionId: uuid.parse(req.params.questionId),
      userId,
      rating: input.rating,
      reason: input.reason ?? null,
      comment: input.comment ?? null,
    });
    res.json({ feedback });
  } catch (err) {
    next(err);
  }
}

/** GET /api/operations/shared/:jobId/ask/feedback?ids=a,b — this person's ratings. */
export async function listAskFeedback(req: Request, res: Response, next: NextFunction) {
  try {
    const { orgId, userId, supabase } = await requireOrgContext(req);
    const ids = String(req.query.ids ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => uuid.safeParse(s).success);
    res.json({ feedback: await myFeedback(supabase, { orgId, jobId: uuid.parse(req.params.jobId), userId, questionIds: ids }) });
  } catch (err) {
    next(err);
  }
}

/** GET /api/operations/shared/:jobId/ask/pins */
export async function listAskPins(req: Request, res: Response, next: NextFunction) {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    res.json({ pins: await listPinnedAnswers(supabase, { orgId, jobId: uuid.parse(req.params.jobId) }) });
  } catch (err) {
    next(err);
  }
}

/** POST /api/operations/shared/:jobId/ask/questions/:questionId/pin */
export async function pinAskAnswer(req: Request, res: Response, next: NextFunction) {
  try {
    const { orgId, userId, supabase } = await requireOrgContext(req);
    const jobId = uuid.parse(req.params.jobId);
    await pinAnswer(supabase, { orgId, jobId, questionId: uuid.parse(req.params.questionId), userId });
    res.json({ pins: await listPinnedAnswers(supabase, { orgId, jobId }) });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/operations/shared/:jobId/ask/questions/:questionId/pin */
export async function unpinAskAnswer(req: Request, res: Response, next: NextFunction) {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const jobId = uuid.parse(req.params.jobId);
    await unpinAnswer(supabase, { orgId, jobId, questionId: uuid.parse(req.params.questionId) });
    res.json({ pins: await listPinnedAnswers(supabase, { orgId, jobId }) });
  } catch (err) {
    next(err);
  }
}

/** GET /api/operations/shared/:jobId/ask/search?q= — this person's own chats on the job. */
export async function searchAskChats(req: Request, res: Response, next: NextFunction) {
  try {
    const { orgId, userId, supabase } = await requireOrgContext(req);
    const query = String(req.query.q ?? '').slice(0, 100);
    res.json({ results: await searchAskHistory(supabase, { orgId, jobId: uuid.parse(req.params.jobId), userId, query }) });
  } catch (err) {
    next(err);
  }
}

/** Approvals are written by the server (members cannot write the table directly). */
function approvalsDb() {
  return unscopedAdminOrNull() ?? requireAdmin();
}

/** GET /api/operations/shared/:jobId/ask/approvals/:id — the card's state. */
export async function getAskApproval(req: Request, res: Response, next: NextFunction) {
  try {
    const { orgId } = await requireOrgContext(req);
    res.json({ approval: await getPendingAction(approvalsDb(), { orgId, jobId: uuid.parse(req.params.jobId), id: uuid.parse(req.params.id) }) });
  } catch (err) {
    next(err);
  }
}

/** POST /api/operations/shared/:jobId/ask/approvals/:id/approve  { body? } — runs the action once. */
export async function approveAskApproval(req: Request, res: Response, next: NextFunction) {
  try {
    const { orgId, userId, supabase } = await requireOrgContext(req);
    const jobId = uuid.parse(req.params.jobId);
    const input = z.object({ body: z.string().max(1600).optional().nullable() }).parse(req.body ?? {});
    const admin = approvalsDb();
    const approval = await approvePendingAction(
      admin,
      { orgId, jobId, id: uuid.parse(req.params.id), userId, editedBody: input.body ?? null },
      { revoke: revokeWith(supabase, admin, orgId, jobId) },
    );
    res.json({ approval });
  } catch (err) {
    next(err);
  }
}

/** POST /api/operations/shared/:jobId/ask/approvals/:id/deny — nothing happens. */
export async function denyAskApproval(req: Request, res: Response, next: NextFunction) {
  try {
    const { orgId, userId } = await requireOrgContext(req);
    res.json({ approval: await denyPendingAction(approvalsDb(), { orgId, jobId: uuid.parse(req.params.jobId), id: uuid.parse(req.params.id), userId }) });
  } catch (err) {
    next(err);
  }
}
