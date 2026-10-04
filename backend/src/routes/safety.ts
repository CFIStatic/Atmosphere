/**
 * Safety incidents API — org members + internal staff.
 *
 *   GET  /api/safety/incidents
 *   GET  /api/safety/incidents/:id
 *   POST /api/safety/incidents/:id/ack
 *   POST /api/safety/incidents/:id/dismiss  ({ category, reason? } — reason required)
 *   GET  /api/safety/settings
 *   PATCH /api/safety/settings  (incl. wellness thresholds)
 *   GET  /api/safety/staff/incidents  (Platform / internal)
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAnalytics } from '../middleware/requireAnalytics.js';
import { badRequest, notFound } from '../lib/errors.js';
import { requireOrgContext, requireGlobalAdmin } from '../lib/orgContext.js';
import { unscopedAdminOrNull } from '../lib/scopedAdmin.js';
import {
  acknowledgeSafetyIncident,
  dismissSafetyIncident,
  getSafetyIncident,
  listSafetyIncidents,
  loadOrgSafetySettings,
  updateOrgSafetySettings,
} from '../safety/index.js';
import { SAFETY_DISMISS_CATEGORIES } from '../safety/types.js';

export const safetyRouter = Router();

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

const listQuery = z.object({
  jobId: z.string().uuid().optional(),
  status: z.enum(['open', 'acknowledged', 'dismissed', 'all']).optional(),
  severity: z.enum(['watch', 'critical']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

safetyRouter.get(
  '/incidents',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = await requireOrgContext(req);
      const q = listQuery.parse(req.query);
      const incidents = await listSafetyIncidents(adminOrThrow(), {
        orgId: ctx.orgId,
        jobId: q.jobId,
        status: q.status ?? 'open',
        severity: q.severity,
        limit: q.limit,
      });
      res.json({
        incidents,
        counts: {
          open: incidents.filter((i) => i.status === 'open').length,
          criticalOpen: incidents.filter((i) => i.status === 'open' && i.severity === 'critical')
            .length,
        },
      });
    } catch (err) {
      if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid query'));
      else next(err);
    }
  },
);

safetyRouter.get(
  '/incidents/:id',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = await requireOrgContext(req);
      const incident = await getSafetyIncident(adminOrThrow(), String(req.params.id));
      if (!incident || incident.orgId !== ctx.orgId) {
        next(notFound('Incident not found', 'safety_not_found'));
        return;
      }
      res.json({ incident });
    } catch (err) {
      next(err);
    }
  },
);

safetyRouter.post(
  '/incidents/:id/ack',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = await requireOrgContext(req);
      const admin = adminOrThrow();
      const existing = await getSafetyIncident(admin, String(req.params.id));
      if (!existing || existing.orgId !== ctx.orgId) {
        next(notFound('Incident not found', 'safety_not_found'));
        return;
      }
      const incident = await acknowledgeSafetyIncident(admin, existing.id, ctx.userId);
      res.json({ incident });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * Dismissing a safety alert needs a reason: a category (feeds false-alarm
 * tuning — e.g. "false_alarm_media" for a TV / podcast) and, for "other",
 * a short note.
 */
const dismissSchema = z
  .object({
    category: z.enum(SAFETY_DISMISS_CATEGORIES),
    reason: z.string().trim().max(1000).optional(),
  })
  .refine((b) => b.category !== 'other' || (b.reason ?? '').length >= 3, {
    message: 'Say why you are dismissing this alert.',
    path: ['reason'],
  });

const DISMISS_LABELS: Record<(typeof SAFETY_DISMISS_CATEGORIES)[number], string> = {
  false_alarm_media: 'False alarm: TV / video / podcast playing',
  joking: 'False alarm: joking',
  staged: 'False alarm: staged / acting',
  not_an_emergency: 'Not an emergency',
  handled: 'Real — handled',
  duplicate: 'Duplicate alert',
  other: 'Other',
};

safetyRouter.post(
  '/incidents/:id/dismiss',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = await requireOrgContext(req);
      const body = dismissSchema.parse(req.body ?? {});
      const admin = adminOrThrow();
      const existing = await getSafetyIncident(admin, String(req.params.id));
      if (!existing || existing.orgId !== ctx.orgId) {
        next(notFound('Incident not found', 'safety_not_found'));
        return;
      }
      const reason = body.reason?.trim()
        ? `${DISMISS_LABELS[body.category]} — ${body.reason.trim()}`
        : DISMISS_LABELS[body.category];
      const incident = await dismissSafetyIncident(admin, existing.id, ctx.userId, reason, body.category);
      res.json({ incident });
    } catch (err) {
      if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid dismiss'));
      else next(err);
    }
  },
);

safetyRouter.get(
  '/settings',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = await requireOrgContext(req);
      const settings = await loadOrgSafetySettings(adminOrThrow(), ctx.orgId);
      res.json({ settings });
    } catch (err) {
      next(err);
    }
  },
);

const settingsPatch = z.object({
  autoEscalateToAuthorities: z.boolean().optional(),
  wellnessCheckEnabled: z.boolean().optional(),
  wellnessNoMotionSeconds: z.number().int().min(60).max(7200).optional(),
  wellnessCriticalAfterSeconds: z.number().int().min(60).max(14400).optional(),
  wellnessRequireAlone: z.boolean().optional(),
  liveSafetyEnabled: z.boolean().optional(),
});

safetyRouter.patch(
  '/settings',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = await requireGlobalAdmin(req);
      const body = settingsPatch.parse(req.body ?? {});
      const settings = await updateOrgSafetySettings(adminOrThrow(), ctx.orgId, {
        autoEscalateToAuthorities: body.autoEscalateToAuthorities,
        wellnessCheckEnabled: body.wellnessCheckEnabled,
        wellnessNoMotionSeconds: body.wellnessNoMotionSeconds,
        wellnessCriticalAfterSeconds: body.wellnessCriticalAfterSeconds,
        wellnessRequireAlone: body.wellnessRequireAlone,
        liveSafetyEnabled: body.liveSafetyEnabled,
      });
      res.json({
        settings,
        note:
          'autoEscalateToAuthorities only sets escalateToAuthorities on alert payloads. ' +
          'Atmosphere never calls 911 or police APIs. Prefer human confirm before enabling. ' +
          'Wellness / silent panic uses configurable no-motion thresholds and never auto-dials 911. ' +
          'See docs/safety-alerts.md and docs/wellness-check.md.',
      });
    } catch (err) {
      if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid settings'));
      else next(err);
    }
  },
);

safetyRouter.get(
  '/staff/incidents',
  requireAuth,
  requireAnalytics('internal'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = listQuery.parse(req.query);
      const orgId =
        typeof req.query.orgId === 'string' && /^[0-9a-f-]{36}$/i.test(req.query.orgId)
          ? req.query.orgId
          : undefined;
      const incidents = await listSafetyIncidents(adminOrThrow(), {
        orgId,
        jobId: q.jobId,
        status: q.status ?? 'open',
        severity: q.severity,
        limit: q.limit ?? 100,
      });
      res.json({
        incidents,
        counts: {
          open: incidents.filter((i) => i.status === 'open').length,
          criticalOpen: incidents.filter((i) => i.status === 'open' && i.severity === 'critical')
            .length,
        },
      });
    } catch (err) {
      if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid query'));
      else next(err);
    }
  },
);

safetyRouter.post(
  '/staff/incidents/:id/ack',
  requireAuth,
  requireAnalytics('internal'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const admin = adminOrThrow();
      const existing = await getSafetyIncident(admin, String(req.params.id));
      if (!existing) {
        next(notFound('Incident not found', 'safety_not_found'));
        return;
      }
      const incident = await acknowledgeSafetyIncident(admin, existing.id, req.user?.id ?? null);
      res.json({ incident });
    } catch (err) {
      next(err);
    }
  },
);

safetyRouter.post(
  '/staff/incidents/:id/dismiss',
  requireAuth,
  requireAnalytics('internal'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = dismissSchema.parse(req.body ?? {});
      const admin = adminOrThrow();
      const existing = await getSafetyIncident(admin, String(req.params.id));
      if (!existing) {
        next(notFound('Incident not found', 'safety_not_found'));
        return;
      }
      const incident = await dismissSafetyIncident(
        admin,
        existing.id,
        req.user?.id ?? null,
        body.reason,
      );
      res.json({ incident });
    } catch (err) {
      if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid dismiss'));
      else next(err);
    }
  },
);
