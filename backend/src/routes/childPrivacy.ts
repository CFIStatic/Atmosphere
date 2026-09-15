/**
 * Child privacy / blur org policy.
 *
 *   GET   /api/child-privacy/settings
 *   PATCH /api/child-privacy/settings
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { badRequest } from '../lib/errors.js';
import { requireGlobalAdmin, requireOrgContext } from '../lib/orgContext.js';
import { unscopedAdminOrNull } from '../lib/scopedAdmin.js';
import {
  loadOrgChildBlurSettings,
  updateOrgChildBlurSettings,
} from '../childPrivacy/index.js';

export const childPrivacyRouter = Router();

function adminOrThrow() {
  const admin = unscopedAdminOrNull();
  if (!admin) {
    throw Object.assign(new Error('Service role unavailable'), {
      status: 503,
      code: 'no_admin',
    });
  }
  return admin;
}

const patchSchema = z.object({
  childBlurEnabled: z.boolean().optional(),
});

childPrivacyRouter.get(
  '/settings',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = await requireOrgContext(req);
      const settings = await loadOrgChildBlurSettings(adminOrThrow(), ctx.orgId);
      res.json({ settings });
    } catch (err) {
      next(err);
    }
  },
);

childPrivacyRouter.patch(
  '/settings',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = await requireGlobalAdmin(req);
      const patch = patchSchema.parse(req.body ?? {});
      const settings = await updateOrgChildBlurSettings(adminOrThrow(), ctx.orgId, patch);
      res.json({ settings });
    } catch (err) {
      if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid body'));
      else next(err);
    }
  },
);
