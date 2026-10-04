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
import { HttpError } from '../lib/errors.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { requireAuth } from '../middleware/requireAuth.js';

export const computerRouter = Router();
computerRouter.use(requireAuth);

const idSchema = z.string().uuid();
const liveSchema = z.object({ mode: z.enum(['watch', 'control']).default('watch') });

function toHttp(err: unknown): unknown {
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
