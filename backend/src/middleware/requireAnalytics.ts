import type { NextFunction, Request, Response } from 'express';
import { createUserClient } from '../lib/supabase.js';
import { getAccess, scopeAtLeast, type AnalyticsScope } from '../lib/analytics.js';
import { HttpError } from '../lib/errors.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      analyticsScope?: AnalyticsScope;
    }
  }
}

/**
 * Gate a route on analytics access.
 *
 * The database enforces this too — every reporting function re-checks the
 * caller's scope — but checking here as well means an under-privileged caller
 * gets a clean 403 rather than a translated database exception, and it keeps the
 * route handlers from having to reason about scope at all.
 *
 * Must run after `requireAuth`.
 */
export function requireAnalytics(min: AnalyticsScope = 'investor') {
  return async function analyticsGate(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const supabase = createUserClient(req.accessToken!);
      const { scope } = await getAccess(supabase);

      if (!scope) {
        throw new HttpError(403, 'You do not have access to Atmosphere analytics.', 'analytics_forbidden');
      }
      if (!scopeAtLeast(scope, min)) {
        throw new HttpError(
          403,
          'This report is limited to the internal Atmosphere team.',
          'analytics_scope_insufficient',
        );
      }

      req.analyticsScope = scope;
      next();
    } catch (err) {
      next(err);
    }
  };
}
