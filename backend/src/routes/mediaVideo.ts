import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { badRequest } from '../lib/errors.js';
import {
  assertProcessableDuration,
  prepareVideoFrames,
  processInboundVideo,
  type VideoSourceKind,
} from '../shared/videoIntelligence.js';

/**
 * Source-agnostic video processing.
 *
 * Proof-of-work uploads already call the same prepareVideoFrames helper
 * internally. This surface exists so field capture, CRM attachments, and
 * any other inbound video can hit the identical sparse+diversity+dictation
 * path without going through a job_proofs row.
 */
export const mediaVideoRouter = Router();

mediaVideoRouter.use(requireAuth);

const processLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many video process requests. Try again later.', code: 'rate_limited' },
});

const sourceSchema = z.enum([
  'proof_of_work',
  'field_capture',
  'media_upload',
  'crm_attachment',
  'external',
  'unknown',
]);

const processSchema = z.object({
  url: z.string().url().max(4000),
  durationSeconds: z.number().positive(),
  source: sourceSchema.default('media_upload'),
  id: z.string().trim().min(1).max(128).optional(),
  contextText: z.string().max(4000).optional(),
  mimeType: z.string().max(128).optional(),
  /** When false, only extract diverse frames (no model call). */
  dictate: z.boolean().default(true),
  maxFrames: z.number().int().positive().max(180).optional(),
});

/**
 * POST /api/media/video/process
 *
 * Body: { url, durationSeconds, source?, id?, contextText?, dictate? }
 * Returns prepared frame timestamps + optional AI dictation.
 *
 * The caller owns storage; this endpoint only reads the signed URL and
 * returns intelligence. Wire any ingress (field day file, CRM clip, …)
 * by minting a URL and posting here.
 */
mediaVideoRouter.post(
  '/process',
  processLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = processSchema.parse(req.body);
      assertProcessableDuration(body.durationSeconds);

      const ref = {
        id: body.id ?? `media-${Date.now()}`,
        source: body.source as VideoSourceKind,
        url: body.url,
        durationSeconds: body.durationSeconds,
        mimeType: body.mimeType ?? null,
        contextText: body.contextText ?? null,
        maxFrames: body.maxFrames,
      };

      if (!body.dictate) {
        const prepared = await prepareVideoFrames(ref);
        res.json({
          id: prepared.id,
          source: prepared.source,
          durationSeconds: prepared.durationSeconds,
          longForm: prepared.longForm,
          frameCount: prepared.frames.length,
          frames: prepared.frames.map((f) => ({
            atSeconds: f.atSeconds,
            reason: f.reason ?? null,
            byteSize: f.jpeg.length,
          })),
          dictation: null,
        });
        return;
      }

      const { prepared, dictation } = await processInboundVideo(ref);
      res.json({
        id: prepared.id,
        source: prepared.source,
        durationSeconds: prepared.durationSeconds,
        longForm: prepared.longForm,
        frameCount: prepared.frames.length,
        frames: prepared.frames.map((f) => ({
          atSeconds: f.atSeconds,
          reason: f.reason ?? null,
          byteSize: f.jpeg.length,
        })),
        dictation: {
          narrationText: dictation.narrationText,
          narrationSummary: dictation.narrationSummary,
          model: dictation.model,
          frameCount: dictation.frameCount,
          events: dictation.events,
        },
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        next(badRequest(err.issues[0]?.message ?? 'Invalid request'));
        return;
      }
      next(err);
    }
  },
);

/**
 * GET /api/media/video/limits
 * Operator-facing caps so clients know what "any inbound video" means here.
 */
mediaVideoRouter.get('/limits', (_req: Request, res: Response) => {
  res.json({
    maxDurationSeconds: config.verification.maxDurationSeconds,
    longFormThresholdSeconds: config.verification.longFormSeconds,
    sparseMaxFrames: config.verification.sparseMaxFrames,
    sparseCandidateIntervalSeconds: config.verification.sparseCandidateIntervalSeconds,
    sparseCoverageIntervalSeconds: config.verification.sparseCoverageIntervalSeconds,
    note:
      'Any fetchable video URL within maxDurationSeconds can be processed via POST /api/media/video/process. Proof uploads use the same prepareVideoFrames helper.',
  });
});
