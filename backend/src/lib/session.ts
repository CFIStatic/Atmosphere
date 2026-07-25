import type { Response } from 'express';
import type { Session } from '@supabase/supabase-js';
import { config } from '../config.js';

/**
 * Session tokens are stored in httpOnly cookies so they are never readable by
 * JavaScript in the browser (mitigates XSS token theft). The browser attaches
 * them automatically on same-site/credentialed requests to the backend.
 */

const baseCookieOptions = {
  httpOnly: true,
  secure: config.cookies.secure,
  sameSite: config.cookies.sameSite,
  domain: config.cookies.domain,
  path: '/',
} as const;

export function setSessionCookies(res: Response, session: Session): void {
  res.cookie(config.cookies.accessTokenName, session.access_token, {
    ...baseCookieOptions,
    maxAge: config.cookies.accessMaxAgeMs,
  });
  res.cookie(config.cookies.refreshTokenName, session.refresh_token, {
    ...baseCookieOptions,
    maxAge: config.cookies.refreshMaxAgeMs,
  });
}

export function clearSessionCookies(res: Response): void {
  // Clearing must use the same attributes (minus maxAge) that were used to set.
  res.clearCookie(config.cookies.accessTokenName, { ...baseCookieOptions });
  res.clearCookie(config.cookies.refreshTokenName, { ...baseCookieOptions });
}

/**
 * The device cookie is deliberately *not* cleared on logout: staying enrolled is
 * the entire point of a PIN, so signing out should return the user to the PIN
 * pad rather than the full password form. It is cleared only when the user
 * disables their PIN, when the device is revoked, or after a password reset.
 */
export function setDeviceCookie(res: Response, value: string): void {
  res.cookie(config.device.cookieName, value, {
    ...baseCookieOptions,
    maxAge: config.device.cookieMaxAgeMs,
  });
}

export function clearDeviceCookie(res: Response): void {
  res.clearCookie(config.device.cookieName, { ...baseCookieOptions });
}
