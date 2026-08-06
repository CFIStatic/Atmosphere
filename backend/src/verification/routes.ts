/**
 * Verification HTTP routes.
 *
 * Modular endpoints for upload, processing status, project timelines,
 * human review, and scene corrections. Long-running work is enqueued —
 * never done inside the request.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { HttpError } from '../lib/errors.js';
import {
  completeVideoUpload,
  createSignedPlaybackUrl,
  createVideoUpload,
  getVideoForOrg,
} from './ingestion/service.js';
import { getVerificationOrchestrator } from './factory.js';
import { pipelineIdempotencyKey } from './pipeline/orchestrator.js';
import {
  getProjectVerificationReport,
  getResultDetail,
  getVideoProcessingStatus,
  groupTimelineByRoom,
} from './reporting/report.js';
import { listOpenReviewTasks, recordReviewDecision } from './review/queue.js';
import { correctSceneRoom } from './scenes/group.js';
import { roomCorrectionSchema } from './schemas.js';
import { monthSpendUsd } from './cost/tracker.js';

export const verificationRouter = Router();

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many upload requests', code: 'rate_limited' },
});

verificationRouter.use(requireAuth);

async function withOrg(req: Request, _res: Response, next: NextFunction) {
  try {
    const ctx = await requireOrgContext(req);
    (req as Request & { orgId: string; userId: string; supabase: unknown }).orgId = ctx.orgId;
    (req as Request & { userId: string }).userId = ctx.userId;
    (req as Request & { supabase: unknown }).supabase = ctx.supabase;
    next();
  } catch (err) {
    next(err);
  }
}

verificationRouter.use(withOrg);

function orgReq(req: Request) {
  const r = req as Request & {
    orgId: string;
    userId: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any;
  };
  return r;
}

/** POST /api/verification/videos — create upload record + signed URL */
verificationRouter.post('/videos', uploadLimiter, async (req, res, next) => {
  try {
    const { orgId, userId, supabase } = orgReq(req);
    const created = await createVideoUpload(
      { supabase, orgId, uploaderId: userId },
      req.body,
    );
    res.status(201).json(created);
  } catch (err) {
    next(toHttp(err));
  }
});

/** POST /api/verification/videos/:videoId/complete — mark uploaded and enqueue */
verificationRouter.post('/videos/:videoId/complete', async (req, res, next) => {
  try {
    const { orgId, userId, supabase } = orgReq(req);
    const videoId = z.string().uuid().parse(req.params.videoId);
    const result = await completeVideoUpload(
      { supabase, orgId, uploaderId: userId },
      videoId,
      req.body,
    );

    if (result.queued) {
      const video = await getVideoForOrg({ supabase, orgId, uploaderId: userId }, videoId);
      const orch = getVerificationOrchestrator();
      const job = await orch.enqueue({
        supabase,
        orgId,
        videoId,
        jobId: video.job_id,
        idempotencyKey: pipelineIdempotencyKey(videoId),
      });
      res.json({ ...result, processingJobId: job.processingJobId });
      return;
    }
    res.json(result);
  } catch (err) {
    next(toHttp(err));
  }
});

/** POST /api/verification/videos/:videoId/reprocess */
verificationRouter.post('/videos/:videoId/reprocess', async (req, res, next) => {
  try {
    const { orgId, userId, supabase } = orgReq(req);
    const videoId = z.string().uuid().parse(req.params.videoId);
    const video = await getVideoForOrg({ supabase, orgId, uploaderId: userId }, videoId);
    const orch = getVerificationOrchestrator();
    const job = await orch.enqueue({
      supabase,
      orgId,
      videoId,
      jobId: video.job_id,
      force: true,
      config: { reason: 'manual_reprocess' },
    });
    res.json(job);
  } catch (err) {
    next(toHttp(err));
  }
});

/** GET /api/verification/videos/:videoId/status */
verificationRouter.get('/videos/:videoId/status', async (req, res, next) => {
  try {
    const { orgId, supabase } = orgReq(req);
    const videoId = z.string().uuid().parse(req.params.videoId);
    const status = await getVideoProcessingStatus(supabase, orgId, videoId);
    res.json(status);
  } catch (err) {
    next(toHttp(err));
  }
});

/** GET /api/verification/videos/:videoId/playback-url — short-lived signed URL */
verificationRouter.get('/videos/:videoId/playback-url', async (req, res, next) => {
  try {
    const { orgId, userId, supabase } = orgReq(req);
    const videoId = z.string().uuid().parse(req.params.videoId);
    const url = await createSignedPlaybackUrl({ supabase, orgId, uploaderId: userId }, videoId);
    res.json(url);
  } catch (err) {
    next(toHttp(err));
  }
});

/** GET /api/verification/jobs/:jobId/report — project timeline + summary */
verificationRouter.get('/jobs/:jobId/report', async (req, res, next) => {
  try {
    const { orgId, supabase } = orgReq(req);
    const jobId = z.string().uuid().parse(req.params.jobId);
    const report = await getProjectVerificationReport(supabase, orgId, jobId);
    res.json({
      ...report,
      byRoom: groupTimelineByRoom(report.timeline),
      verified: report.timeline.filter((e) =>
        ['verified', 'likely_verified', 'human_verified'].includes(e.status),
      ),
      uncertain: report.timeline.filter((e) =>
        ['uncertain', 'needs_review'].includes(e.status),
      ),
      rejected: report.timeline.filter((e) =>
        ['rejected', 'contradicted'].includes(e.status),
      ),
    });
  } catch (err) {
    next(toHttp(err));
  }
});

/** GET /api/verification/results/:resultId */
verificationRouter.get('/results/:resultId', async (req, res, next) => {
  try {
    const { orgId, supabase } = orgReq(req);
    const resultId = z.string().uuid().parse(req.params.resultId);
    res.json(await getResultDetail(supabase, orgId, resultId));
  } catch (err) {
    next(toHttp(err));
  }
});

/** GET /api/verification/reviews */
verificationRouter.get('/reviews', async (req, res, next) => {
  try {
    const { orgId, supabase } = orgReq(req);
    const jobId = req.query.jobId ? z.string().uuid().parse(req.query.jobId) : undefined;
    res.json({ tasks: await listOpenReviewTasks(supabase, orgId, { jobId }) });
  } catch (err) {
    next(toHttp(err));
  }
});

/** POST /api/verification/reviews/:taskId/decisions */
verificationRouter.post('/reviews/:taskId/decisions', async (req, res, next) => {
  try {
    const { orgId, userId, supabase } = orgReq(req);
    const taskId = z.string().uuid().parse(req.params.taskId);
    const result = await recordReviewDecision(supabase, {
      orgId,
      taskId,
      reviewerId: userId,
      body: req.body,
    });
    res.status(201).json(result);
  } catch (err) {
    next(toHttp(err));
  }
});

/** PATCH /api/verification/scenes/:sceneId — manual room correction */
verificationRouter.patch('/scenes/:sceneId', async (req, res, next) => {
  try {
    const { orgId, userId, supabase } = orgReq(req);
    const sceneId = z.string().uuid().parse(req.params.sceneId);
    const body = roomCorrectionSchema.parse(req.body);
    await correctSceneRoom(supabase, {
      orgId,
      sceneId,
      roomType: body.roomType,
      label: body.label,
      locationId: body.locationId,
      actorId: userId,
    });
    res.json({ ok: true });
  } catch (err) {
    next(toHttp(err));
  }
});

/** GET /api/verification/usage — month spend / limits */
verificationRouter.get('/usage', async (req, res, next) => {
  try {
    const { orgId, supabase } = orgReq(req);
    const spent = await monthSpendUsd(supabase, orgId);
    const { data: limits } = await supabase
      .from('verification_usage_limits')
      .select('*')
      .eq('org_id', orgId)
      .maybeSingle();
    res.json({ spentUsd: spent, limits: limits ?? null });
  } catch (err) {
    next(toHttp(err));
  }
});

function toHttp(err: unknown): unknown {
  if (err instanceof HttpError) return err;
  if (err instanceof z.ZodError) return err;
  const message = err instanceof Error ? err.message : String(err);
  if (/not found/i.test(message)) return new HttpError(404, message, 'not_found');
  if (/not match|unsupported|must be|cannot complete|budget/i.test(message)) {
    return new HttpError(400, message, 'validation_error');
  }
  return err;
}
