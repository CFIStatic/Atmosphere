/**
 * Staff-only legal hold, vault, and user-monitor API.
 *
 * Mounted at /api/legal. Gated by requireAuth + internal analytics scope —
 * the same bar as the internal accounts file. Customers never see these
 * routes succeed.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAnalytics } from '../middleware/requireAnalytics.js';
import { badRequest } from '../lib/errors.js';
import {
  AUTO_HOLD_RULES,
  buildStaffJobLegalPortal,
  createLegalHold,
  evaluateAutoHolds,
  getLegalHold,
  listLegalHolds,
  listUserActivity,
  produceHold,
  releaseLegalHold,
  requireVault,
  runAutoHoldSweep,
  signedVaultUrl,
  unreviewedAutoHolds,
} from '../legal/index.js';
import { LEGAL_HOLD_KINDS, LEGAL_SUBJECT_TYPES } from '../legal/types.js';

export const legalRouter = Router();

legalRouter.use(requireAuth);
legalRouter.use(requireAnalytics('internal'));

const subjectSchema = z.object({
  subjectType: z.enum(LEGAL_SUBJECT_TYPES),
  subjectId: z.string().uuid(),
});

const createHoldSchema = z.object({
  caseNumber: z.string().trim().min(1).max(120),
  kind: z.enum(LEGAL_HOLD_KINDS),
  title: z.string().trim().min(1).max(240),
  reason: z.string().trim().min(1).max(4000),
  counselName: z.string().trim().max(200).optional(),
  receivedAt: z.string().datetime().optional(),
  dueAt: z.string().datetime().optional(),
  subjects: z.array(subjectSchema).min(1).max(200),
});

const releaseSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
});

const produceSchema = z.object({
  note: z.string().trim().max(2000).optional(),
});

const sweepSchema = z.object({
  jobId: z.string().uuid().optional(),
  apply: z.boolean().default(true),
});

const activityQuerySchema = z.object({
  actorUserId: z.string().uuid().optional(),
  orgId: z.string().uuid().optional(),
  action: z.string().trim().max(120).optional(),
  resourceType: z.string().trim().max(64).optional(),
  resourceId: z.string().trim().max(128).optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

/** GET /api/legal/holds */
legalRouter.get('/holds', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const holds = await listLegalHolds();
    res.json({
      holds,
      counts: {
        open: holds.filter((hold) => hold.status === 'open').length,
        released: holds.filter((hold) => hold.status === 'released').length,
      },
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/legal/holds */
legalRouter.post('/holds', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createHoldSchema.parse(req.body ?? {});
    const hold = await createLegalHold({
      ...body,
      createdBy: req.user?.id ?? null,
    });
    res.status(201).json({ hold });
  } catch (err) {
    if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid hold'));
    else next(err);
  }
});

/** GET /api/legal/holds/:id */
legalRouter.get('/holds/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const hold = await getLegalHold(String(req.params.id));
    res.json({ hold });
  } catch (err) {
    next(err);
  }
});

/** POST /api/legal/holds/:id/release */
legalRouter.post('/holds/:id/release', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = releaseSchema.parse(req.body ?? {});
    const hold = await releaseLegalHold(String(req.params.id), {
      releasedBy: req.user?.id ?? null,
      reason: body.reason,
    });
    res.json({ hold });
  } catch (err) {
    if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid release'));
    else next(err);
  }
});

/**
 * POST /api/legal/holds/:id/produce
 * Assemble vaulted videos (including customer-deleted) + the activity trail.
 */
legalRouter.post('/holds/:id/produce', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = produceSchema.parse(req.body ?? {});
    const pack = await produceHold({
      holdId: String(req.params.id),
      requestedBy: req.user?.id ?? null,
      note: body.note ?? null,
    });
    res.status(201).json(pack);
  } catch (err) {
    if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid production'));
    else next(err);
  }
});

/**
 * GET /api/legal/auto-holds
 *
 * The preservation desk. What the rules would freeze right now, what they
 * already froze, and which automatic holds are past their review date and
 * waiting on a person. Read-only — nothing opens from a GET.
 */
legalRouter.get('/auto-holds', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jobId = typeof req.query.jobId === 'string' ? req.query.jobId : null;
    const [signals, holds] = await Promise.all([evaluateAutoHolds({ jobId }), listLegalHolds()]);
    const automatic = holds.filter((hold) => hold.origin === 'automatic');
    res.json({
      rules: AUTO_HOLD_RULES.map((rule) => ({
        key: rule.key,
        label: rule.label,
        kind: rule.kind,
        why: rule.why,
        reviewAfterDays: rule.reviewAfterDays,
      })),
      signals,
      holds: automatic,
      counts: {
        firing: signals.length,
        unfrozen: signals.filter((signal) => !signal.heldBy).length,
        open: automatic.filter((hold) => hold.status === 'open').length,
        awaitingReview: unreviewedAutoHolds(automatic).length,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/legal/auto-holds/sweep
 *
 * Run the rules and freeze what fired. Idempotent — a job already under an
 * open hold is counted, not re-held. `apply: false` is the dry run.
 */
legalRouter.post('/auto-holds/sweep', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = sweepSchema.parse(req.body ?? {});
    const sweep = await runAutoHoldSweep({ jobId: body.jobId ?? null, apply: body.apply });
    res.status(sweep.opened.length ? 201 : 200).json(sweep);
  } catch (err) {
    if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid sweep'));
    else next(err);
  }
});

/** GET /api/legal/videos/:vaultId/url — signed read of a vaulted clip */
legalRouter.get('/videos/:vaultId/url', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const video = await requireVault(String(req.params.vaultId));
    const url = await signedVaultUrl(video, 600);
    res.json({
      url,
      video: {
        id: video.id,
        orgId: video.orgId,
        sourceKind: video.sourceKind,
        sourceId: video.sourceId,
        userDeleted: Boolean(video.userDeletedAt),
        contentHash: video.contentHash,
        byteSize: video.byteSize,
        durationSeconds: video.durationSeconds,
      },
      expiresInSeconds: 600,
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/legal/jobs/:jobId — staff job portal, including customer-deleted clips */
legalRouter.get('/jobs/:jobId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const portal = await buildStaffJobLegalPortal({ jobId: String(req.params.jobId) });
    res.json(portal);
  } catch (err) {
    next(err);
  }
});

/** GET /api/legal/activity — user-action monitor */
legalRouter.get('/activity', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = activityQuerySchema.parse(req.query);
    const events = await listUserActivity(query);
    res.json({ events, count: events.length });
  } catch (err) {
    if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid query'));
    else next(err);
  }
});

/** GET /api/legal/users/:userId — one person's trail */
legalRouter.get('/users/:userId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const events = await listUserActivity({
      actorUserId: String(req.params.userId),
      limit: 500,
    });
    res.json({
      userId: req.params.userId,
      events,
      count: events.length,
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/legal/orgs/:orgId — one tenant's trail */
legalRouter.get('/orgs/:orgId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const events = await listUserActivity({
      orgId: String(req.params.orgId),
      limit: 500,
    });
    res.json({
      orgId: req.params.orgId,
      events,
      count: events.length,
    });
  } catch (err) {
    next(err);
  }
});
