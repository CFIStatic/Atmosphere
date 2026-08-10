import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { logger } from '../lib/logger.js';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

/**
 * Assigns a request id (honoring inbound `x-request-id`) and emits one
 * structured access log line when the response finishes.
 */
export function requestLog(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.header('x-request-id')?.trim();
  const requestId =
    inbound && inbound.length > 0 && inbound.length <= 128 ? inbound : randomUUID();
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  const started = Date.now();
  res.on('finish', () => {
    // Health/ready probes are high-volume and low-signal — keep them out of
    // info logs so real traffic is not drowned out. Debug still captures them.
    const quiet =
      req.path === '/api/health' ||
      req.path === '/api/ready' ||
      req.path === '/health' ||
      req.path === '/ready';
    const fields = {
      requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - started,
      ip: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    };
    if (quiet) {
      logger.debug('request', fields);
      return;
    }
    if (res.statusCode >= 500) {
      logger.error('request', fields);
    } else if (res.statusCode >= 400) {
      logger.warn('request', fields);
    } else {
      logger.info('request', fields);
    }
  });

  next();
}
