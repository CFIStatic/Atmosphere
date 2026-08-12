import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { createAdminClient } from '../lib/supabase.js';
import { badRequest, serviceUnavailable } from '../lib/errors.js';
import { getFieldContextSession, listFieldContextSessions } from '../fieldContext/store.js';

/**
 * Office read API for Field Capture context — organized device / sensor /
 * location / motion bundles collected while the crew films.
 */
export const fieldContextRouter = Router();

fieldContextRouter.use(requireAuth);

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

/** GET /api/operations/field-context */
fieldContextRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId } = await requireOrgContext(req);
    const admin = await adminOrThrow();
    const jobId = typeof req.query.jobId === 'string' ? req.query.jobId : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    res.json(await listFieldContextSessions(admin, { orgId, jobId, limit }));
  } catch (err) {
    next(err);
  }
});

/** GET /api/operations/field-context/:sessionId */
fieldContextRouter.get(
  '/:sessionId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId } = await requireOrgContext(req);
      const admin = await adminOrThrow();
      res.json(await getFieldContextSession(admin, { orgId, sessionId: req.params.sessionId }));
    } catch (err) {
      if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid request'));
      else next(err);
    }
  },
);
