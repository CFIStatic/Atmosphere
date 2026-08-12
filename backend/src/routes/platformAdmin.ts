import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { requirePlatformStaff } from '../middleware/requirePlatformStaff.js';
import { ensureAllowlistedPlatformAccess } from '../lib/platformAccess.js';
import { HttpError } from '../lib/errors.js';
import {
  BROWSABLE_TABLES,
  browseTable,
  generateRecoveryLink,
  getInfrastructureSnapshot,
  getOrgDetail,
  getPlatformAccess,
  getUserDetail,
  listAudit,
  listOrgs,
  listUsers,
  requireAdminClient,
  sendPasswordReset,
  setUserBanned,
  writeAudit,
} from '../lib/platformAdmin.js';

export const platformAdminRouter = Router();

platformAdminRouter.use(requireAuth);

/**
 * GET /api/admin/access
 *
 * Deliberately NOT behind the staff gate: the app shell asks this to decide
 * whether to show the Internal link at all.
 */
platformAdminRouter.get('/access', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await ensureAllowlistedPlatformAccess(req.user);
    res.json(await getPlatformAccess(req.accessToken!));
  } catch (err) {
    next(err);
  }
});

// Everything below requires at least support scope.
platformAdminRouter.use(requirePlatformStaff('support'));

const listQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  page: z.coerce.number().int().min(1).optional(),
});

platformAdminRouter.get('/orgs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Invalid query', 'invalid_query');
    }
    const admin = requireAdminClient();
    res.json(await listOrgs(admin, parsed.data));
  } catch (err) {
    next(err);
  }
});

platformAdminRouter.get('/orgs/:orgId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = z.string().uuid().parse(req.params.orgId);
    const admin = requireAdminClient();
    const org = await getOrgDetail(admin, orgId);
    res.json({ org });
  } catch (err) {
    next(err);
  }
});

platformAdminRouter.get('/users', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Invalid query', 'invalid_query');
    }
    const admin = requireAdminClient();
    res.json(await listUsers(admin, parsed.data));
  } catch (err) {
    next(err);
  }
});

platformAdminRouter.get('/users/:userId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = z.string().uuid().parse(req.params.userId);
    const admin = requireAdminClient();
    const user = await getUserDetail(admin, userId);
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

const passwordActionSchema = z.object({
  mode: z.enum(['email', 'link']).default('email'),
});

/** Send a reset email or mint a one-time recovery link for phone support. */
platformAdminRouter.post(
  '/users/:userId/reset-password',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = z.string().uuid().parse(req.params.userId);
      const body = passwordActionSchema.parse(req.body ?? {});
      const admin = requireAdminClient();
      const user = await getUserDetail(admin, userId);
      if (!user.email) {
        throw new HttpError(400, 'User has no email address.', 'user_email_missing');
      }

      if (body.mode === 'link') {
        const { actionLink } = await generateRecoveryLink(admin, user.email);
        await writeAudit(admin, req, {
          action: 'user.recovery_link',
          targetType: 'user',
          targetId: userId,
          detail: { email: user.email },
        });
        res.json({ ok: true, mode: 'link', actionLink, email: user.email });
        return;
      }

      await sendPasswordReset(user.email);
      await writeAudit(admin, req, {
        action: 'user.password_reset_email',
        targetType: 'user',
        targetId: userId,
        detail: { email: user.email },
      });
      res.json({ ok: true, mode: 'email', email: user.email });
    } catch (err) {
      next(err);
    }
  },
);

const banSchema = z.object({
  banned: z.boolean(),
});

/** Ban / unban — admin scope (support can reset passwords but not lock accounts). */
platformAdminRouter.post(
  '/users/:userId/ban',
  requirePlatformStaff('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = z.string().uuid().parse(req.params.userId);
      const { banned } = banSchema.parse(req.body ?? {});
      const admin = requireAdminClient();

      if (userId === req.user?.id) {
        throw new HttpError(400, 'You cannot ban your own account.', 'cannot_ban_self');
      }

      await setUserBanned(admin, userId, banned);
      await writeAudit(admin, req, {
        action: banned ? 'user.ban' : 'user.unban',
        targetType: 'user',
        targetId: userId,
      });
      res.json({ ok: true, banned });
    } catch (err) {
      next(err);
    }
  },
);

platformAdminRouter.get('/audit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).optional(),
        offset: z.coerce.number().int().min(0).optional(),
        orgId: z.string().uuid().optional(),
      })
      .safeParse(req.query);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Invalid query', 'invalid_query');
    }
    const admin = requireAdminClient();
    res.json(await listAudit(admin, parsed.data));
  } catch (err) {
    next(err);
  }
});

/** Infrastructure snapshot — ops scope. */
platformAdminRouter.get(
  '/infrastructure',
  requirePlatformStaff('ops'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const admin = requireAdminClient();
      const snapshot = await getInfrastructureSnapshot(admin);
      await writeAudit(admin, req, { action: 'infra.view' });
      res.json(snapshot);
    } catch (err) {
      next(err);
    }
  },
);

platformAdminRouter.get(
  '/database/tables',
  requirePlatformStaff('ops'),
  (_req: Request, res: Response) => {
    res.json({ tables: BROWSABLE_TABLES });
  },
);

platformAdminRouter.get(
  '/database/:table',
  requirePlatformStaff('ops'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const table = z.string().min(1).max(64).parse(req.params.table);
      const parsed = z
        .object({
          limit: z.coerce.number().int().min(1).max(100).optional(),
          offset: z.coerce.number().int().min(0).optional(),
          orgId: z.string().uuid().optional(),
        })
        .safeParse(req.query);
      if (!parsed.success) {
        throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Invalid query', 'invalid_query');
      }
      const admin = requireAdminClient();
      const result = await browseTable(admin, table, parsed.data);
      await writeAudit(admin, req, {
        action: 'database.browse',
        targetType: 'table',
        targetId: table,
        orgId: parsed.data.orgId,
        detail: { limit: parsed.data.limit ?? 50, offset: parsed.data.offset ?? 0 },
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);
