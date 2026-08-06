import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { badRequest, notFound } from '../lib/errors.js';
import { config } from '../config.js';
import {
  beginMediaUpload,
  completeMediaUpload,
  getMedia,
  listMediaForOrg,
  markTier,
  orgUsage,
  setOrgQuota,
  getOrgQuota,
} from '../media/catalog.js';
import { formatDurationHours } from '../media/quotas.js';
import { MEDIA_KINDS, MEDIA_TIERS } from '../media/types.js';
import { readUrlFor } from '../media/driver.js';

/**
 * Fleet media catalog API.
 *
 * One upload session = one video object (≤ ~24h). Aggregate retention of
 * billions of hours is many such objects in object storage + this catalog —
 * never one unbounded file and never bytes in Postgres.
 */
export const mediaCatalogRouter = Router();

mediaCatalogRouter.use(requireAuth);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many media requests. Try again later.', code: 'rate_limited' },
});
mediaCatalogRouter.use(limiter);

/**
 * GET /api/media/catalog/scale
 * Product/ops view of the scale model and current deployment knobs.
 */
mediaCatalogRouter.get('/scale', (_req, res) => {
  res.json({
    maxDurationSecondsPerObject: config.verification.maxDurationSeconds,
    note:
      'Each video object is capped near 24h. Fleet capacity is unbounded object count in hot/warm/cold storage, catalogued here by id — not one longer recording.',
    backend: config.media.backend,
    hotBucket: config.media.hotBucket,
    archiveBucket: config.media.archiveBucket || null,
    multipartThresholdBytes: config.media.multipartThresholdBytes,
    defaultQuotas: {
      maxHotBytes: config.media.defaultMaxHotBytes,
      maxTotalBytes: config.media.defaultMaxTotalBytes,
      maxIngestSecondsPerDay: config.media.defaultMaxIngestSecondsPerDay,
      maxObjectBytes: config.media.defaultMaxObjectBytes,
    },
  });
});

/** GET /api/media/catalog/usage */
mediaCatalogRouter.get('/usage', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId } = await requireOrgContext(req);
    const usage = orgUsage(orgId);
    res.json({
      usage,
      quota: getOrgQuota(orgId),
      totalHoursRetained: formatDurationHours(usage.totalDurationSeconds),
      ingestHoursToday: formatDurationHours(usage.ingestDurationSecondsToday),
    });
  } catch (err) {
    next(err);
  }
});

const beginSchema = z.object({
  kind: z.enum(MEDIA_KINDS).default('field_day_video'),
  contentType: z.string().trim().min(3).max(128).default('video/mp4'),
  durationSeconds: z.number().positive().optional(),
  byteSize: z.number().int().positive().optional(),
  ext: z.string().trim().max(16).optional(),
  refType: z.string().trim().max(64).optional(),
  refId: z.string().trim().max(128).optional(),
  preferMultipart: z.boolean().optional(),
});

/**
 * POST /api/media/catalog/uploads
 * Mint an upload session for one ≤24h object (signed URL or multipart plan).
 */
mediaCatalogRouter.post('/uploads', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId } = await requireOrgContext(req);
    const body = beginSchema.parse(req.body ?? {});
    const { media, session } = await beginMediaUpload({ orgId, ...body });
    res.status(201).json({ media, session });
  } catch (err) {
    if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid request'));
    else next(err);
  }
});

const completeSchema = z.object({
  sessionId: z.string().uuid(),
  byteSize: z.number().int().positive().optional(),
  contentHash: z.string().trim().min(8).max(128).optional(),
  durationSeconds: z.number().positive().optional(),
});

/** POST /api/media/catalog/uploads/complete */
mediaCatalogRouter.post(
  '/uploads/complete',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId } = await requireOrgContext(req);
      const body = completeSchema.parse(req.body ?? {});
      const media = completeMediaUpload({ orgId, ...body });
      res.json({ media });
    } catch (err) {
      if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid request'));
      else next(err);
    }
  },
);

/** GET /api/media/catalog/objects */
mediaCatalogRouter.get('/objects', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId } = await requireOrgContext(req);
    res.json({ objects: listMediaForOrg(orgId) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/media/catalog/objects/:id */
mediaCatalogRouter.get(
  '/objects/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId } = await requireOrgContext(req);
      const media = getMedia(String(req.params.id));
      if (!media || media.orgId !== orgId) throw notFound('Media object not found');
      res.json({ media });
    } catch (err) {
      next(err);
    }
  },
);

/** GET /api/media/catalog/objects/:id/url — short-lived playback / process URL */
mediaCatalogRouter.get(
  '/objects/:id/url',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId } = await requireOrgContext(req);
      const media = getMedia(String(req.params.id));
      if (!media || media.orgId !== orgId) throw notFound('Media object not found');
      if (media.state !== 'ready') {
        throw badRequest('Media is not ready for read', 'media_not_ready');
      }
      const url = await readUrlFor(media, 600);
      res.json({ url, mediaId: media.id, tier: media.tier, expiresInSeconds: 600 });
    } catch (err) {
      next(err);
    }
  },
);

const tierSchema = z.object({
  tier: z.enum(MEDIA_TIERS),
});

/**
 * POST /api/media/catalog/objects/:id/tier
 * Mark catalog tier (hot/warm/cold). Real byte moves are driver/lifecycle.
 */
mediaCatalogRouter.post(
  '/objects/:id/tier',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId } = await requireOrgContext(req);
      const body = tierSchema.parse(req.body ?? {});
      const media = markTier(String(req.params.id), orgId, body.tier);
      res.json({ media });
    } catch (err) {
      if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid request'));
      else next(err);
    }
  },
);

const quotaSchema = z.object({
  maxHotBytes: z.number().int().positive().nullable().optional(),
  maxTotalBytes: z.number().int().positive().nullable().optional(),
  maxIngestSecondsPerDay: z.number().int().positive().nullable().optional(),
  maxObjectBytes: z.number().int().positive().nullable().optional(),
});

/**
 * PUT /api/media/catalog/quota
 * Set soft org ceilings (foundation: in-memory; durable via org_media_quotas).
 */
mediaCatalogRouter.put('/quota', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId } = await requireOrgContext(req);
    const body = quotaSchema.parse(req.body ?? {});
    const current = getOrgQuota(orgId);
    const nextQuota = {
      orgId,
      maxHotBytes: body.maxHotBytes === undefined ? current.maxHotBytes : body.maxHotBytes,
      maxTotalBytes: body.maxTotalBytes === undefined ? current.maxTotalBytes : body.maxTotalBytes,
      maxIngestSecondsPerDay:
        body.maxIngestSecondsPerDay === undefined
          ? current.maxIngestSecondsPerDay
          : body.maxIngestSecondsPerDay,
      maxObjectBytes: body.maxObjectBytes === undefined ? current.maxObjectBytes : body.maxObjectBytes,
    };
    setOrgQuota(nextQuota);
    res.json({ quota: nextQuota, usage: orgUsage(orgId) });
  } catch (err) {
    if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid request'));
    else next(err);
  }
});
