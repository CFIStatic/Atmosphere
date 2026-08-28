import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAnalytics } from '../middleware/requireAnalytics.js';
import {
  cyberSnapshot,
  cyberStore,
  triggerCyberPatch,
  unblockIp,
} from '../cyber/index.js';
import { config } from '../config.js';

/**
 * Operator visibility into the Cyber Defense Agent.
 *
 * These routes never weaken defense: status and history are read-mostly, unblock
 * is deliberate and rate-limited, and "patch now" only runs the same hardening
 * cycle the scheduler already runs. All of them are staff-only — the same bar
 * as /api/legal — so a field or office login cannot lift a ban.
 */

export const cyberRouter = Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many cyber requests. Try again later.', code: 'rate_limited' },
});

const patchLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many patch requests. Try again later.', code: 'rate_limited' },
});

cyberRouter.use(limiter);
cyberRouter.use(requireAuth);
cyberRouter.use(requireAnalytics('internal'));

/** GET /api/cyber/status — posture snapshot. */
cyberRouter.get('/status', (_req: Request, res: Response) => {
  res.json({
    status: cyberSnapshot(),
    config: {
      enabled: config.cyber.enabled,
      monitoring: config.cyber.monitoring,
      deception: config.cyber.deception,
      autoBlock: config.cyber.autoBlock,
      autoPatch: config.cyber.autoPatch,
      patchIntervalMinutes: config.cyber.patchIntervalMinutes,
    },
  });
});

/** GET /api/cyber/events — recent threat events (newest first). */
cyberRouter.get('/events', (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = z.coerce.number().int().min(1).max(500).optional().parse(req.query.limit) ?? 100;
    res.json({ events: cyberStore.listEvents(limit) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/cyber/blocks — active IP bans. */
cyberRouter.get('/blocks', (_req: Request, res: Response) => {
  res.json({ blocks: cyberStore.listBlocks() });
});

/** GET /api/cyber/patches — recent auto-patch results. */
cyberRouter.get('/patches', (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = z.coerce.number().int().min(1).max(200).optional().parse(req.query.limit) ?? 50;
    res.json({ patches: cyberStore.listPatches(limit) });
  } catch (err) {
    next(err);
  }
});

const unblockSchema = z.object({
  ip: z.string().trim().min(3).max(64),
});

/** POST /api/cyber/unblock — lift a ban (false-positive escape hatch). */
cyberRouter.post('/unblock', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ip } = unblockSchema.parse(req.body);
    const ok = unblockIp(ip);
    res.json({ ok, ip, unblocked: ok });
  } catch (err) {
    next(err);
  }
});

/** POST /api/cyber/patch — run one hardening cycle now. */
cyberRouter.post('/patch', patchLimiter, (_req: Request, res: Response) => {
  const patches = triggerCyberPatch('api');
  res.json({
    ok: true,
    patches,
    status: cyberSnapshot(),
  });
});
