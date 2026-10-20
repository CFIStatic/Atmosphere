/**
 * Clip summary ratings and corrections for office members, and the workspace
 * "Help improve Atmosphere's AI" switch. Rating routes mount on
 * sharedJobsRouter (requireAuth); the switch mounts on orgRouter.
 */
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { requireGlobalAdmin, requireOrgContext } from '../lib/orgContext.js';
import { requireAdmin } from '../lib/scopedAdmin.js';
import {
  CLIP_FEEDBACK_REASONS,
  CORRECTION_MAX_CHARS,
  getAiTrainingSetting,
  myClipFeedback,
  rateClipSummary,
  setAiTrainingSetting,
} from '../shared/clipSummaryFeedback.js';

const uuid = z.string().uuid();

/** POST /api/operations/shared/:jobId/proofs/:proofId/summary-feedback  { rating: 1 | -1 | 0, reason?, correctedText? } */
export async function rateClipSummaryRoute(req: Request, res: Response, next: NextFunction) {
  try {
    const { orgId, userId } = await requireOrgContext(req);
    const input = z
      .object({
        rating: z.union([z.literal(1), z.literal(-1), z.literal(0)]),
        reason: z.enum(CLIP_FEEDBACK_REASONS).optional().nullable(),
        correctedText: z.string().trim().max(CORRECTION_MAX_CHARS).optional().nullable(),
      })
      .parse(req.body ?? {});
    const feedback = await rateClipSummary(requireAdmin(), {
      orgId,
      jobId: uuid.parse(req.params.jobId),
      proofId: uuid.parse(req.params.proofId),
      userId,
      rating: input.rating,
      reason: input.reason ?? null,
      correctedText: input.correctedText ?? null,
    });
    res.json({ feedback });
  } catch (err) {
    next(err);
  }
}

/** GET /api/operations/shared/:jobId/proofs/summary-feedback — this person's ratings on the job's clips. */
export async function listClipSummaryFeedback(req: Request, res: Response, next: NextFunction) {
  try {
    const { orgId, userId } = await requireOrgContext(req);
    res.json({
      feedback: await myClipFeedback(requireAdmin(), { orgId, jobId: uuid.parse(req.params.jobId), userId }),
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/org/ai-training — any member can see whether it is on. */
export async function getAiTraining(req: Request, res: Response, next: NextFunction) {
  try {
    const { orgId } = await requireOrgContext(req);
    res.json({ setting: await getAiTrainingSetting(requireAdmin(), orgId) });
  } catch (err) {
    next(err);
  }
}

/** PUT /api/org/ai-training  { optedIn: boolean } — Global Admin only. */
export async function putAiTraining(req: Request, res: Response, next: NextFunction) {
  try {
    const { orgId, userId } = await requireGlobalAdmin(req);
    const { optedIn } = z.object({ optedIn: z.boolean() }).parse(req.body ?? {});
    res.json({ setting: await setAiTrainingSetting(requireAdmin(), { orgId, userId, optedIn }) });
  } catch (err) {
    next(err);
  }
}
