import { Router, type Request, type Response } from 'express';

export const healthRouter = Router();

/** Liveness probe — no auth, no dependencies. */
healthRouter.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'atmosphere-backend', time: new Date().toISOString() });
});
