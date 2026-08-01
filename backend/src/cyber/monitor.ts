import type { NextFunction, Request, Response } from 'express';
import { inspectRequest } from './agent.js';
import { config } from '../config.js';

/**
 * Express middleware that puts the Cyber Defense Agent in front of every route.
 *
 * Mounted early — before routers — so blocked IPs and honeypot hits never reach
 * auth, billing, or CRM handlers.
 */
export async function cyberMonitor(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!config.cyber.enabled) {
    next();
    return;
  }

  try {
    const result = await inspectRequest(req, res);
    if (result.handled) return;
    next();
  } catch (err) {
    // Defense must not take the API down. Log and continue.
    console.error('[cyber] monitor error:', err instanceof Error ? err.message : err);
    next();
  }
}
