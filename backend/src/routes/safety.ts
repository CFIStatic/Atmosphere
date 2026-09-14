/**
 * Safety incidents API — org members + internal staff.
 *
 *   GET  /api/safety/incidents
 *   GET  /api/safety/incidents/:id
 *   POST /api/safety/incidents/:id/ack
 *   POST /api/safety/incidents/:id/dismiss
 *   GET  /api/safety/settings
 *   PATCH /api/safety/settings
 *   GET  /api/safety/staff/incidents  (Platform / internal)
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAnalytics } from '../middleware/requireAnalytics.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
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

const dismissSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
});

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
      const incident = await dismissSafetyIncident(admin, existing.id, ctx.userId, body.reason);
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
  alertWebhookUrl: z
    .union([z.string().url(), z.null()])
    .optional(),
  alertEmails: z.array(z.string().email().max(200)).max(20).optional(),
});

safetyRouter.patch(
  '/settings',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = await requireGlobalAdmin(req);
      const body = settingsPatch.parse(req.body ?? {});
      if (body.alertWebhookUrl && !/^https:\/\//i.test(body.alertWebhookUrl)) {
        next(forbidden('Webhook URL must be https', 'invalid_webhook'));
        return;
      }
      const settings = await updateOrgSafetySettings(adminOrThrow(), ctx.orgId, {
        autoEscalateToAuthorities: body.autoEscalateToAuthorities,
        alertWebhookUrl: body.alertWebhookUrl,
        alertEmails: body.alertEmails,
      });
      res.json({
        settings,
        note:
          'autoEscalateToAuthorities only sets escalateToAuthorities on alert payloads. ' +
          'Atmosphere never calls 911 or police APIs. Prefer human confirm before enabling. ' +
          'See docs/safety-alerts.md.',
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
