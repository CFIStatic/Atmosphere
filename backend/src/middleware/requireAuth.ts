import type { NextFunction, Request, Response } from 'express';
import type { User } from '@supabase/supabase-js';
import { config } from '../config.js';
import { createAnonClient } from '../lib/supabase.js';
import { setSessionCookies, clearSessionCookies } from '../lib/session.js';
import { unauthorized } from '../lib/errors.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
      accessToken?: string;
    }
  }
}

/**
 * Validates the caller's session.
 *
 * 1. Reads the access token from the httpOnly cookie and asks Supabase to
 *    verify it (`getUser` validates the JWT signature + expiry server-side).
 * 2. If the access token is missing/expired but a refresh token is present,
 *    it transparently refreshes the session and re-issues cookies.
 * 3. On success, attaches `req.user` and `req.accessToken`; otherwise 401.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const accessToken = req.cookies?.[config.cookies.accessTokenName] as string | undefined;
    const refreshToken = req.cookies?.[config.cookies.refreshTokenName] as string | undefined;
    const supabase = createAnonClient();

    if (accessToken) {
      const { data, error } = await supabase.auth.getUser(accessToken);
      if (!error && data.user) {
        req.user = data.user;
        req.accessToken = accessToken;
        next();
        return;
      }
    }

    // Access token missing or invalid — try to refresh.
    if (refreshToken) {
      const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
      if (!error && data.session && data.user) {
        setSessionCookies(res, data.session);
        req.user = data.user;
        req.accessToken = data.session.access_token;
        next();
        return;
      }
    }

    clearSessionCookies(res);
    throw unauthorized();
  } catch (err) {
    next(err);
  }
}
