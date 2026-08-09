import type { NextFunction, Request, Response } from 'express';
import type { User } from '@supabase/supabase-js';
import { config } from '../config.js';
import { createAnonClient } from '../lib/supabase.js';
import { setSessionCookies, clearSessionCookies } from '../lib/session.js';
import { unauthorized, serviceUnavailable } from '../lib/errors.js';
import { isTransient } from '../lib/upstream.js';

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
 * Pull a Bearer access token from Authorization when present.
 * Native Field Capture (and other non-browser clients) cannot rely on
 * httpOnly cookies the way the dashboard SPA does.
 */
export function bearerAccessToken(req: Request): string | undefined {
  const header = req.get('authorization') ?? req.get('Authorization');
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token || undefined;
}

/**
 * Validates the caller's session.
 *
 * 1. Reads the access token from the httpOnly cookie **or** `Authorization:
 *    Bearer` and asks Supabase to verify it (`getUser` validates the JWT
 *    signature + expiry server-side).
 * 2. If the access token is missing/expired but a refresh token cookie is
 *    present, it transparently refreshes the session and re-issues cookies.
 * 3. On a transient upstream failure it returns 503 and leaves cookies intact.
 * 4. On a genuine auth failure it clears cookies and returns 401.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const cookieAccess = req.cookies?.[config.cookies.accessTokenName] as string | undefined;
    const refreshToken = req.cookies?.[config.cookies.refreshTokenName] as string | undefined;
    const accessToken = cookieAccess || bearerAccessToken(req);
    const supabase = createAnonClient();

    if (accessToken) {
      const { data, error } = await supabase.auth.getUser(accessToken);
      if (!error && data.user) {
        req.user = data.user;
        req.accessToken = accessToken;
        next();
        return;
      }
      // Transient upstream error → don't touch the session, ask caller to retry.
      if (error && isTransient(error)) {
        next(serviceUnavailable());
        return;
      }
      // Otherwise the access token is genuinely invalid/expired → try refresh.
    }

    if (refreshToken) {
      const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
      if (!error && data.session && data.user) {
        setSessionCookies(res, data.session);
        req.user = data.user;
        req.accessToken = data.session.access_token;
        next();
        return;
      }
      // Transient error during refresh → keep the (still-valid) cookies.
      if (error && isTransient(error)) {
        next(serviceUnavailable());
        return;
      }
    }

    // Genuine auth failure — no valid token could be established.
    clearSessionCookies(res);
    throw unauthorized();
  } catch (err) {
    next(err);
  }
}
