/**
 * Computer (Chat's browser agent) — org members only.
 *
 *   GET  /api/chat-computer/status                 is Computer set up?
 *   GET  /api/chat-computer/tasks/:id              task, recent steps, open approval
 *   POST /api/chat-computer/tasks/:id/live         { mode: 'watch' | 'control' } → short-lived live-view URL
 *   POST /api/chat-computer/tasks/:id/hand-back    give the mouse back to the agent
 *   POST /api/chat-computer/tasks/:id/resume       after sign-in / 2FA / captcha
 *   POST /api/chat-computer/tasks/:id/cancel
 *   POST /api/chat-computer/approvals/:id/approve
 *   POST /api/chat-computer/approvals/:id/cancel
 *
 * Logins page (sign in to outside sites ahead of time; no AI runs):
 *   GET    /api/chat-computer/logins                     saved sites + any sign-in in progress
 *   POST   /api/chat-computer/logins/sign-ins            { url, label? } or { loginId } → open the site
 *   POST   /api/chat-computer/logins/sign-ins/:id/live   → short-lived live-view URL (control)
 *   POST   /api/chat-computer/logins/sign-ins/:id/done   "Done, I'm signed in" → save the site
 *   POST   /api/chat-computer/logins/sign-ins/:id/cancel close without saving
 *   DELETE /api/chat-computer/logins/:id                 remove the site, its saved password, and its cookies
 *   PUT    /api/chat-computer/logins/:id/credential      { username, password, loginUrl? } save/replace (Global Admin)
 *   DELETE /api/chat-computer/logins/:id/credential      delete the saved password (Global Admin)
 *
 * Saved passwords: only a Global Admin (productRole 'global_admin': DB roles
 * global_admin and office_manager) may save, see usernames for, replace or
 * delete them; any member can run tasks that use them. Request bodies are
 * never logged, and no response ever carries a password.
 *
 * Every lookup is filtered by the caller's org; another org's id is a 404.
 * Live-view URLs are minted per request, sent with Cache-Control: no-store,
 * and never logged or stored (request logs carry the path only).
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  cancelTask,
  ComputerServiceError,
  computerStatus,
  decideApproval,
  handBackControl,
  loadTaskView,
  mintLiveView,
  resumeTask,
} from '../computer/service.js';
import { CredentialsOffError } from '../computer/credentialCrypto.js';
import {
  cancelSignIn,
  deleteCredential,
  finishSignIn,
  loginsState,
  removeLogin,
  saveCredential,
  signInLiveView,
  startSignIn,
} from '../computer/logins.js';
import { HttpError } from '../lib/errors.js';
import { requireGlobalAdmin, requireOrgContext } from '../lib/orgContext.js';
import { requireAuth } from '../middleware/requireAuth.js';

export const computerRouter = Router();
computerRouter.use(requireAuth);

const idSchema = z.string().uuid();
const liveSchema = z.object({ mode: z.enum(['watch', 'control']).default('watch') });

function toHttp(err: unknown): unknown {
  if (err instanceof CredentialsOffError) return new HttpError(503, err.message, 'credentials_disabled');
  if (!(err instanceof ComputerServiceError)) return err;
  const status =
    err.code === 'not_found'
      ? 404
      : err.code === 'not_set_up'
        ? 503
        : err.code === 'conflict'
          ? 409
          : err.code === 'ai_paused'
            ? 402
            : err.code === 'not_allowed'
              ? 403
              : 400;
  return new HttpError(status, err.message, err.code === 'not_set_up' ? 'computer_not_set_up' : err.code);
}

function parseId(raw: unknown): string {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(404, 'Not found', 'not_found');
  return parsed.data;
}

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    await fn(req, res);
  } catch (err) {
    next(toHttp(err));
  }
};

computerRouter.get(
  '/status',
  wrap(async (req, res) => {
    await requireOrgContext(req);
    res.json(computerStatus());
  }),
);

computerRouter.get(
  '/tasks/:id',
  wrap(async (req, res) => {
    const ctx = await requireOrgContext(req);
    const view = await loadTaskView(ctx.orgId, parseId(req.params.id), ctx.userId);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ task: view });
  }),
);

computerRouter.post(
  '/tasks/:id/live',
  wrap(async (req, res) => {
    const ctx = await requireOrgContext(req);
    const { mode } = liveSchema.parse(req.body ?? {});
    const link = await mintLiveView(ctx.orgId, parseId(req.params.id), ctx.userId, mode);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.json(link);
  }),
);

computerRouter.post(
  '/tasks/:id/hand-back',
  wrap(async (req, res) => {
    const ctx = await requireOrgContext(req);
    await handBackControl(ctx.orgId, parseId(req.params.id), ctx.userId);
    res.json({ ok: true });
  }),
);

computerRouter.post(
  '/tasks/:id/resume',
  wrap(async (req, res) => {
    const ctx = await requireOrgContext(req);
    await resumeTask(ctx.orgId, parseId(req.params.id), ctx.userId);
    res.json({ ok: true });
  }),
);

computerRouter.post(
  '/tasks/:id/cancel',
  wrap(async (req, res) => {
    const ctx = await requireOrgContext(req);
    await cancelTask(ctx.orgId, parseId(req.params.id), ctx.userId);
    res.json({ ok: true });
  }),
);

computerRouter.post(
  '/approvals/:id/approve',
  wrap(async (req, res) => {
    const ctx = await requireOrgContext(req);
    res.json(await decideApproval(ctx.orgId, parseId(req.params.id), ctx.userId, 'approve'));
  }),
);

computerRouter.post(
  '/approvals/:id/cancel',
  wrap(async (req, res) => {
    const ctx = await requireOrgContext(req);
    res.json(await decideApproval(ctx.orgId, parseId(req.params.id), ctx.userId, 'cancel'));
  }),
);

/* ------------------------------------------------------------------ Logins -- */

/** Lengths are checked in logins.ts so error messages never repeat a value. */
const credentialSchema = z.object({
  username: z.string(),
  password: z.string(),
  loginUrl: z.string().max(2048).nullable().optional(),
});

const signInSchema = z.object({
  url: z.string().trim().max(2048).optional(),
  label: z.string().trim().max(80).optional(),
  loginId: z.string().uuid().optional(),
  credential: credentialSchema.optional(),
});

const isAdmin = (ctx: { productRole: string }) => ctx.productRole === 'global_admin';

computerRouter.get(
  '/logins',
  wrap(async (req, res) => {
    const ctx = await requireOrgContext(req);
    res.setHeader('Cache-Control', 'no-store');
    res.json(await loginsState(ctx.orgId, ctx.userId, isAdmin(ctx)));
  }),
);

computerRouter.post(
  '/logins/sign-ins',
  wrap(async (req, res) => {
    const ctx = await requireOrgContext(req);
    const parsed = signInSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new HttpError(400, 'Enter the website address, like outlook.office.com.', 'bad_request');
    const signIn = await startSignIn({
      orgId: ctx.orgId,
      userId: ctx.userId,
      url: parsed.data.url ?? null,
      label: parsed.data.label ?? null,
      loginId: parsed.data.loginId ?? null,
      canManage: isAdmin(ctx),
      credential: parsed.data.credential ?? null,
    });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ signIn });
  }),
);

computerRouter.post(
  '/logins/sign-ins/:id/live',
  wrap(async (req, res) => {
    const ctx = await requireOrgContext(req);
    const link = await signInLiveView(ctx.orgId, parseId(req.params.id), ctx.userId);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.json(link);
  }),
);

computerRouter.post(
  '/logins/sign-ins/:id/done',
  wrap(async (req, res) => {
    const ctx = await requireOrgContext(req);
    res.json({ login: await finishSignIn(ctx.orgId, parseId(req.params.id), ctx.userId) });
  }),
);

computerRouter.post(
  '/logins/sign-ins/:id/cancel',
  wrap(async (req, res) => {
    const ctx = await requireOrgContext(req);
    await cancelSignIn(ctx.orgId, parseId(req.params.id), ctx.userId);
    res.json({ ok: true });
  }),
);

computerRouter.delete(
  '/logins/:id',
  wrap(async (req, res) => {
    const ctx = await requireOrgContext(req);
    res.json(await removeLogin(ctx.orgId, parseId(req.params.id), ctx.userId, isAdmin(ctx)));
  }),
);

computerRouter.put(
  '/logins/:id/credential',
  wrap(async (req, res) => {
    const ctx = await requireGlobalAdmin(req);
    const parsed = credentialSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new HttpError(400, 'Enter the username and password.', 'bad_request');
    const login = await saveCredential({
      orgId: ctx.orgId,
      loginId: parseId(req.params.id),
      userId: ctx.userId,
      canManage: isAdmin(ctx),
      credential: parsed.data,
    });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ login });
  }),
);

computerRouter.delete(
  '/logins/:id/credential',
  wrap(async (req, res) => {
    const ctx = await requireGlobalAdmin(req);
    res.json(await deleteCredential({ orgId: ctx.orgId, loginId: parseId(req.params.id), userId: ctx.userId, canManage: isAdmin(ctx) }));
  }),
);
