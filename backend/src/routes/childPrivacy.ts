/**
 * Child privacy / blur — read-only status (always on).
 *
 *   GET   /api/child-privacy/settings  → { settings: { orgId, childBlurEnabled: true } }
 *   PATCH /api/child-privacy/settings  → 400 (cannot disable; mandatory)
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { badRequest } from '../lib/errors.js';
import { requireGlobalAdmin, requireOrgContext } from '../lib/orgContext.js';
import { loadOrgChildBlurSettings } from '../childPrivacy/index.js';

export const childPrivacyRouter = Router();

childPrivacyRouter.get(
  '/settings',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = await requireOrgContext(req);
      const settings = await loadOrgChildBlurSettings(null, ctx.orgId);
      res.json({ settings });
    } catch (err) {
      next(err);
    }
  },
);

childPrivacyRouter.patch(
  '/settings',
  requireAuth,
  async (req: Request, _res: Response, next: NextFunction) => {
    try {
      await requireGlobalAdmin(req);
      next(
        badRequest(
          'Child privacy blur is mandatory and cannot be turned off.',
        ),
      );
    } catch (err) {
      next(err);
    }
  },
);
