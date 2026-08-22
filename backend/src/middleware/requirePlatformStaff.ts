import type { NextFunction, Request, Response } from 'express';
import {
  getPlatformAccess,
  platformScopeAtLeast,
  type PlatformStaffScope,
} from '../lib/platformAdmin.js';
import { ensureAllowlistedPlatformAccess } from '../lib/platformAccess.js';
import { HttpError } from '../lib/errors.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      platformScope?: PlatformStaffScope;
    }
  }
}

/**
 * Gate a route on Atmosphere internal admin access.
 *
 * Must run after `requireAuth`. Database allow-list is the source of truth;
 * this middleware gives a clean 403 before any service-role work begins.
 */
export function requirePlatformStaff(min: PlatformStaffScope = 'support') {
  return async function platformStaffGate(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      await ensureAllowlistedPlatformAccess(req.user);

      const { scope } = await getPlatformAccess(req.accessToken!);
      if (!scope) {
        throw new HttpError(
          403,
          'You do not have access to the Atmosphere internal portal.',
          'platform_admin_forbidden',
        );
      }
      if (!platformScopeAtLeast(scope, min)) {
        throw new HttpError(
          403,
          'This action requires a higher Atmosphere staff scope.',
          'platform_admin_scope_insufficient',
        );
      }

      req.platformScope = scope;
      next();
    } catch (err) {
      next(err);
    }
  };
}
