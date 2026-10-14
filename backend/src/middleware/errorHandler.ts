import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../lib/errors.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

/**
 * True only for errors errorHandler answers with a 500. Validation errors,
 * HttpErrors below 500 and body-parser rejections are expected and not reported.
 */
export function shouldReportError(err: unknown): boolean {
  if (err instanceof ZodError) return false;
  if (err instanceof HttpError) return err.status >= 500;
  const bodyErr = err as { type?: string } | null;
  if (bodyErr && typeof bodyErr.type === 'string' && bodyErr.type.startsWith('entity.')) return false;
  return true;
}

/** 404 handler for unmatched routes. */
export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found', code: 'not_found' });
}

/** Central error handler — converts thrown errors into consistent JSON. */
export function errorHandler(
  err: unknown,
  req: Request,
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
    const { error: _ignoredError, code: _ignoredCode, ...safeDetails } = err.details ?? {};
    res.status(err.status).json({ error: err.message, code: err.code, ...safeDetails });
    return;
  }

  // body-parser rejections (oversized or malformed JSON). They carry a status
  // and a `type`, but are plain Errors — without this they fall through to the
  // 500 below and a client that simply sent too much data is told the server
  // broke, which sends them looking in entirely the wrong place.
  const bodyErr = err as { type?: string; status?: number; statusCode?: number };
  if (typeof bodyErr.type === 'string' && bodyErr.type.startsWith('entity.')) {
    const status = bodyErr.status ?? bodyErr.statusCode ?? 400;
    const tooLarge = bodyErr.type === 'entity.too.large';
    res.status(status).json({
      error: tooLarge ? 'That request body is too large.' : 'Could not parse the request body.',
      code: tooLarge ? 'payload_too_large' : 'invalid_body',
    });
    return;
  }

  // Unknown/unexpected error — log server-side, return generic message.
  logger.error('unhandled_error', {
    requestId: req.requestId,
    path: req.path,
    method: req.method,
    err: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
  });
  // Reported to Sentry by Sentry.setupExpressErrorHandler (see app.ts),
  // which runs just before this handler and uses shouldReportError below.
  res.status(500).json({
    error: 'Internal server error',
    code: 'internal_error',
    ...(config.isProduction ? {} : { detail: err instanceof Error ? err.message : String(err) }),
  });
}
