/**
 * Daily job report settings + manual trigger.
 *
 *   GET   /api/daily-report/settings
 *   PATCH /api/daily-report/settings
 *   POST  /api/daily-report/run   (global admin QA)
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { badRequest } from '../lib/errors.js';
import { requireGlobalAdmin, requireOrgContext } from '../lib/orgContext.js';
import { unscopedAdminOrNull } from '../lib/scopedAdmin.js';
import {
  loadOrgDailyReportSettings,
  runDailyReportNow,
  updateOrgDailyReportSettings,
} from '../dailyReport/index.js';

export const dailyReportRouter = Router();

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
  enabled: z.boolean().optional(),
  timezone: z.string().min(1).max(64).optional(),
  channel: z.enum(['email', 'sms', 'email_and_sms']).optional(),
  sendHour: z.number().int().min(0).max(23).optional(),
  extraEmails: z.array(z.string().email()).max(20).optional(),
});

dailyReportRouter.get(
  '/settings',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = await requireOrgContext(req);
      const settings = await loadOrgDailyReportSettings(adminOrThrow(), ctx.orgId);
      res.json({ settings });
    } catch (err) {
      next(err);
    }
  },
);

dailyReportRouter.patch(
  '/settings',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = await requireGlobalAdmin(req);
      const patch = patchSchema.parse(req.body ?? {});
      const settings = await updateOrgDailyReportSettings(adminOrThrow(), ctx.orgId, patch);
      res.json({ settings });
    } catch (err) {
      if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid body'));
      else next(err);
    }
  },
);

const runSchema = z.object({
  jobId: z.string().uuid(),
  localDay: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

dailyReportRouter.post(
  '/run',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = await requireGlobalAdmin(req);
      const body = runSchema.parse(req.body ?? {});
      const result = await runDailyReportNow({
        orgId: ctx.orgId,
        jobId: body.jobId,
        localDay: body.localDay,
      });
      res.json(result);
    } catch (err) {
      if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid body'));
      else next(err);
    }
  },
);
