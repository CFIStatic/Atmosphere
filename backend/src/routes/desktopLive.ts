/**
 * Live view for a Windows desktop session, served by this server so the
 * frame stays same-origin (the app's existing CSP frames 'self').
 *
 * The capability is the signed token in the path, minted by mintLiveView:
 * it names one session, one org, an expiry and whether input is allowed.
 * These routes verify the token themselves and run before the Computer
 * router's auth, so rapid frame polling doesn't re-validate a session on
 * every request. Nothing here is logged (frames show customer data).
 *
 *   GET  /api/chat-computer/desktop-live/viewer.css
 *   GET  /api/chat-computer/desktop-live/viewer.js
 *   GET  /api/chat-computer/desktop-live/:token/           viewer page
 *   GET  /api/chat-computer/desktop-live/:token/frame      current screen (JPEG)
 *   POST /api/chat-computer/desktop-live/:token/input      click/type/key/scroll (control tokens only)
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { desktopHostFor } from '../computer/desktop/config.js';
import {
  LIVE_VIEW_CSS,
  LIVE_VIEW_JS,
  liveViewHtml,
  liveTokenOrg,
  verifyLiveToken,
  type LiveToken,
} from '../computer/desktop/liveView.js';
import { windowsDesktopProvider } from '../computer/providers/index.js';
import { logger } from '../lib/logger.js';

export const desktopLiveRouter = Router();

const inputSchema = z.object({
  action: z.enum(['click', 'move', 'down', 'up', 'drag', 'type', 'key', 'scroll']),
  x: z.number().int().min(0).max(4000).optional(),
  y: z.number().int().min(0).max(4000).optional(),
  from: z.tuple([z.number(), z.number()]).optional(),
  to: z.tuple([z.number(), z.number()]).optional(),
  button: z.enum(['left', 'right', 'middle']).optional(),
  clickCount: z.number().int().min(1).max(3).optional(),
  direction: z.enum(['up', 'down', 'left', 'right']).optional(),
  amount: z.number().int().min(1).max(20).optional(),
  combo: z.string().max(64).optional(),
  repeat: z.number().int().min(1).max(50).optional(),
  text: z.string().max(2000).optional(),
});

function tokenFromPath(raw: unknown): LiveToken | null {
  const token = String(raw ?? '');
  const orgId = liveTokenOrg(token);
  if (!orgId) return null;
  const host = desktopHostFor(orgId);
  if (!host) return null;
  return verifyLiveToken(host.secret, token, Date.now());
}

function noStore(res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

desktopLiveRouter.get('/viewer.css', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.type('text/css').send(LIVE_VIEW_CSS);
});

desktopLiveRouter.get('/viewer.js', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.type('application/javascript').send(LIVE_VIEW_JS);
});

desktopLiveRouter.get('/:token/', (req: Request, res: Response) => {
  const token = tokenFromPath(req.params.token);
  if (!token) {
    res.status(404).type('text/plain').send('This live view has expired. Open it again.');
    return;
  }
  noStore(res);
  res.type('html').send(liveViewHtml(token.c === 1));
});

desktopLiveRouter.get('/:token/frame', async (req: Request, res: Response) => {
  const token = tokenFromPath(req.params.token);
  if (!token) {
    res.status(404).end();
    return;
  }
  try {
    const jpeg = await windowsDesktopProvider().liveFrame(token.s);
    noStore(res);
    res.type('image/jpeg').send(Buffer.from(jpeg, 'base64'));
  } catch {
    res.status(502).end();
  }
});

desktopLiveRouter.post('/:token/input', async (req: Request, res: Response) => {
  const token = tokenFromPath(req.params.token);
  if (!token) {
    res.status(404).end();
    return;
  }
  if (token.c !== 1) {
    res.status(403).end();
    return;
  }
  const parsed = inputSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).end();
    return;
  }
  try {
    await windowsDesktopProvider().liveInput(token.s, parsed.data);
    noStore(res);
    res.json({ ok: true });
  } catch (err) {
    logger.warn('desktop live input failed', { error: err instanceof Error ? err.name : 'error' });
    res.status(502).end();
  }
});
