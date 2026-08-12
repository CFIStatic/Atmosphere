import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAnalytics } from '../middleware/requireAnalytics.js';
import { createAdminClient } from '../lib/supabase.js';
import { badRequest, serviceUnavailable } from '../lib/errors.js';
import { getFieldContextSession, listFieldContextSessions } from '../fieldContext/store.js';

/**
 * Atmosphere-internal Field Capture context.
 *
 * Recorded from the field app into the backend; readable only by internal
 * analytics staff. Never mounted under customer job-file / evidence routes.
 */
export const fieldContextRouter = Router();

fieldContextRouter.use(requireAuth);
fieldContextRouter.use(requireAnalytics('internal'));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 240,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many field context requests.', code: 'rate_limited' },
});
fieldContextRouter.use(limiter);

async function adminOrThrow() {
  const admin = createAdminClient();
  if (!admin) throw serviceUnavailable('Storage admin is not configured.', 'admin_unavailable');
  return admin;
}

/** GET /api/analytics/field-context */
fieldContextRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const admin = await adminOrThrow();
    const orgId = typeof req.query.orgId === 'string' ? req.query.orgId : undefined;
    const jobId = typeof req.query.jobId === 'string' ? req.query.jobId : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    res.json(await listFieldContextSessions(admin, { orgId, jobId, limit }));
  } catch (err) {
    next(err);
  }
});

/** GET /api/analytics/field-context/:sessionId */
fieldContextRouter.get(
  '/:sessionId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const admin = await adminOrThrow();
      res.json(await getFieldContextSession(admin, { sessionId: req.params.sessionId }));
    } catch (err) {
      if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid request'));
      else next(err);
    }
  },
);
