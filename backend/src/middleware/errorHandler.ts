import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../lib/errors.js';
import { config } from '../config.js';

/** 404 handler for unmatched routes. */
export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found', code: 'not_found' });
}

/** Central error handler — converts thrown errors into consistent JSON. */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
   
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: err.issues[0]?.message ?? 'Invalid input',
      code: 'validation_error',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }

  // Unknown/unexpected error — log server-side, return generic message.
  console.error('[unhandled error]', err);
  res.status(500).json({
    error: 'Internal server error',
    code: 'internal_error',
    ...(config.isProduction ? {} : { detail: err instanceof Error ? err.message : String(err) }),
  });
}
