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
import { linkOutcomeSchema, roomCorrectionSchema } from './schemas.js';
import { monthSpendUsd } from './cost/tracker.js';
import { linkOutcome } from './timeline/graph.js';
import { createDatasetExampleFromResult } from './dataset/examples.js';
import { exportDatasetVersionJsonl } from './dataset/exportJsonl.js';
import { getVerificationCapabilities } from './capabilities.js';

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

/**
 * GET /api/verification/capabilities
 * Whether this deployment can analyse video for real. Returns booleans and
 * env var *names* only — never key material.
 */
verificationRouter.get('/capabilities', (_req, res) => {
  res.json(getVerificationCapabilities());
});

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

/** GET /api/verification/jobs/:jobId/timeline */
verificationRouter.get('/jobs/:jobId/timeline', async (req, res, next) => {
  try {
    const { orgId, supabase } = orgReq(req);
    const jobId = z.string().uuid().parse(req.params.jobId);
    const { data, error } = await supabase
      .from('project_timeline_events')
      .select(
        'id, occurred_at, title, summary, status, completion_state, room_or_area, activity_id, system_confidence, confidence_breakdown, evidence_frame_ids, evidence_clip_ids, result_id, llm_run_id, provenance',
      )
      .eq('org_id', orgId)
      .eq('job_id', jobId)
      .order('occurred_at', { ascending: true, nullsFirst: false });
    if (error) throw new Error(error.message);
    res.json({ jobId, events: data ?? [] });
  } catch (err) {
    next(toHttp(err));
  }
});

/** GET /api/verification/jobs/:jobId/workflow */
verificationRouter.get('/jobs/:jobId/workflow', async (req, res, next) => {
  try {
    const { orgId, supabase } = orgReq(req);
    const jobId = z.string().uuid().parse(req.params.jobId);
    const { data, error } = await supabase
      .from('workflow_relationships')
      .select('id, from_event_id, to_event_id, relation, confidence, provenance, created_at')
      .eq('org_id', orgId)
      .eq('job_id', jobId);
    if (error) throw new Error(error.message);
    res.json({ jobId, relationships: data ?? [] });
  } catch (err) {
    next(toHttp(err));
  }
});

/** POST /api/verification/jobs/:jobId/outcomes */
verificationRouter.post('/jobs/:jobId/outcomes', async (req, res, next) => {
  try {
    const { orgId, supabase } = orgReq(req);
    const jobId = z.string().uuid().parse(req.params.jobId);
    const body = linkOutcomeSchema.parse(req.body);
    const id = await linkOutcome(supabase, {
      orgId,
      jobId,
      timelineEventId: body.timelineEventId,
      resultId: body.resultId,
      outcomeType: body.outcomeType,
      externalRef: body.externalRef,
      amountCents: body.amountCents,
      occurredAt: body.occurredAt,
      payload: body.payload,
    });
    res.status(201).json({ id });
  } catch (err) {
    next(toHttp(err));
  }
});

/** GET /api/verification/ontology */
verificationRouter.get('/ontology', async (req, res, next) => {
  try {
    const { supabase } = orgReq(req);
    const [activities, states, materials, equipment, damage] = await Promise.all([
      supabase.from('work_ontology_activities').select('id, trade_id, name, description, version'),
      supabase.from('work_ontology_states').select('id, name, kind, version'),
      supabase.from('work_ontology_materials').select('id, name, version'),
      supabase.from('work_ontology_equipment').select('id, name, version'),
      supabase.from('work_ontology_damage_types').select('id, name, version'),
    ]);
    res.json({
      activities: activities.data ?? [],
      states: states.data ?? [],
      materials: materials.data ?? [],
      equipment: equipment.data ?? [],
      damageTypes: damage.data ?? [],
    });
  } catch (err) {
    next(toHttp(err));
  }
});

const rightsBodySchema = z.object({
  category: z.enum([
    'operational_only',
    'internal_improvement',
    'evaluation_allowed',
    'training_allowed',
    'restricted',
    'pending_review',
    'revoked',
  ]),
  operationalProcessing: z.boolean().optional(),
  internalImprovement: z.boolean().optional(),
  evaluationAllowed: z.boolean().optional(),
  trainingAllowed: z.boolean().optional(),
  policyVersion: z.string().optional(),
});

/** POST /api/verification/results/:resultId/dataset-example */
verificationRouter.post('/results/:resultId/dataset-example', async (req, res, next) => {
  try {
    const { orgId, supabase } = orgReq(req);
    const resultId = z.string().uuid().parse(req.params.resultId);
    const rights = rightsBodySchema.parse(req.body?.rights ?? req.body);
    const purpose = z
      .enum(['training', 'evaluation', 'internal_improvement'])
      .optional()
      .parse(req.body?.purpose);
    const out = await createDatasetExampleFromResult(supabase, {
      orgId,
      resultId,
      rights,
      purpose,
      datasetName: req.body?.datasetName,
      datasetVersion: req.body?.datasetVersion,
    });
    if (!out.eligible) {
      res.status(422).json({ eligible: false, reasons: out.reasons });
      return;
    }
    res.status(201).json(out);
  } catch (err) {
    next(toHttp(err));
  }
});

/** POST /api/verification/datasets/versions/:versionId/export */
verificationRouter.post('/datasets/versions/:versionId/export', async (req, res, next) => {
  try {
    const { orgId, supabase } = orgReq(req);
    const versionId = z.string().uuid().parse(req.params.versionId);
    const splitFilter = req.body?.split
      ? z
          .enum(['train', 'validation', 'test', 'benchmark', 'holdout', 'private_evaluation'])
          .parse(req.body.split)
      : null;
    const result = await exportDatasetVersionJsonl(supabase, {
      orgId,
      datasetVersionId: versionId,
      splitFilter,
      writeLocal: process.env.NODE_ENV !== 'production',
    });
    res.status(201).json(result);
  } catch (err) {
    next(toHttp(err));
  }
});

/** GET /api/verification/datasets/versions/:versionId/examples */
verificationRouter.get('/datasets/versions/:versionId/examples', async (req, res, next) => {
  try {
    const { orgId, supabase } = orgReq(req);
    const versionId = z.string().uuid().parse(req.params.versionId);
    const { data, error } = await supabase
      .from('dataset_examples')
      .select('id, split, task_type, quality_score, privacy_status, canonical, created_at')
      .eq('org_id', orgId)
      .eq('dataset_version_id', versionId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    res.json({ examples: data ?? [] });
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
