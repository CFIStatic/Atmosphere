/**
 * Connect CRM — credential + agent login APIs.
 *
 *   GET    /api/crm-credentials          status for four CRMs (no passwords)
 *   POST   /api/crm-credentials/connect  save username/password + verify login
 *   DELETE /api/crm-credentials/:system  disconnect
 *   POST   /api/crm-credentials/:system/verify  re-run verify job
 *
 * Passwords are sealed before storage. Response bodies never include them.
 * Request logs must not print the password field (logger redaction + we never
 * pass body.password to logger).
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { badRequest, HttpError } from '../lib/errors.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { unscopedAdminOrNull } from '../lib/scopedAdmin.js';
import {
  CRM_AGENT_SYSTEMS,
  deleteCrmCredentials,
  listCrmCredentialStatus,
  saveCrmCredentials,
  verifyCrmLoginInline,
  type CrmAgentSystem,
} from '../crm/index.js';
import { logger } from '../lib/logger.js';

export const crmCredentialsRouter = Router();
crmCredentialsRouter.use(requireAuth);

function adminOrThrow() {
  const admin = unscopedAdminOrNull();
  if (!admin) {
    throw new HttpError(503, 'Service role unavailable', 'no_admin');
  }
  return admin;
}

const systemSchema = z.enum(CRM_AGENT_SYSTEMS);

const connectSchema = z.object({
  system: systemSchema,
  username: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(500),
  notes: z.string().trim().max(2000).optional().nullable(),
});

crmCredentialsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = await requireOrgContext(req);
    const admin = adminOrThrow();
    const systems = await listCrmCredentialStatus(admin, ctx.orgId);
    res.json({
      systems,
      copy: {
        headline: 'Connect',
        body: 'An Atmosphere agent signs in with your CRM login to pull and update jobs, contacts, and claims.',
      },
    });
  } catch (err) {
    next(err);
  }
});

crmCredentialsRouter.post(
  '/connect',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = await requireOrgContext(req);
      const body = connectSchema.parse(req.body);
      const admin = adminOrThrow();

      // Never log password. Username is fine.
      logger.info('crm_credentials_connect_request', {
        orgId: ctx.orgId,
        system: body.system,
        username: body.username,
      });

      const saved = await saveCrmCredentials(admin, {
        orgId: ctx.orgId,
        userId: ctx.userId,
        system: body.system,
        username: body.username,
        password: body.password,
        notes: body.notes ?? null,
        status: 'pending_verify',
      });

      const verify = await verifyCrmLoginInline(admin, {
        orgId: ctx.orgId,
        userId: ctx.userId,
        system: body.system,
      });

      const systems = await listCrmCredentialStatus(admin, ctx.orgId);
      const current = systems.find((s) => s.system === body.system) ?? saved;

      res.json({
        system: current,
        verify: {
          ok: verify.ok,
          summary: verify.summary,
          mode: verify.mode ?? null,
        },
      });
    } catch (err) {
      if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid input'));
      else next(err);
    }
  },
);

crmCredentialsRouter.delete(
  '/:system',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = await requireOrgContext(req);
      const system = systemSchema.parse(req.params.system);
      const admin = adminOrThrow();
      await deleteCrmCredentials(admin, ctx.orgId, system as CrmAgentSystem);
      res.json({ ok: true, system });
    } catch (err) {
      if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid system'));
      else next(err);
    }
  },
);

crmCredentialsRouter.post(
  '/:system/verify',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = await requireOrgContext(req);
      const system = systemSchema.parse(req.params.system);
      const admin = adminOrThrow();
      const verify = await verifyCrmLoginInline(admin, {
        orgId: ctx.orgId,
        userId: ctx.userId,
        system: system as CrmAgentSystem,
      });
      const systems = await listCrmCredentialStatus(admin, ctx.orgId);
      res.json({
        verify: {
          ok: verify.ok,
          summary: verify.summary,
          mode: verify.mode ?? null,
        },
        system: systems.find((s) => s.system === system) ?? null,
      });
    } catch (err) {
      if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid system'));
      else next(err);
    }
  },
);
