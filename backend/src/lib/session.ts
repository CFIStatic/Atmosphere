import type { Response } from 'express';
import type { Session } from '@supabase/supabase-js';
import { config } from '../config.js';

/**
 * Session tokens are stored in httpOnly cookies so they are never readable by
 * JavaScript in the browser (mitigates XSS token theft). The browser attaches
 * them automatically on same-site requests.
 *
 * platform.atmosphereteam.com and app.atmosphereteam.com are one site. A
 * host-only cookie set on either host is invisible to the other, so a crew
 * member signed into Platform still saw Field Capture's "Welcome back" login.
 * On an atmosphereteam.com host the session cookie is scoped to that parent
 * domain. HttpOnly, Secure, and SameSite stay as configured — this is not
 * SameSite=None, and the device PIN cookie is not widened.
 */

const ATMOSPHERE_SITE = 'atmosphereteam.com';

export function sessionCookieDomain(publicHost: string | undefined | null): string | undefined {
  if (config.cookies.domain) return config.cookies.domain;
  const host = String(publicHost ?? '')
    .split(',')[0]!
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, '');
  if (!host) return undefined;
  if (host === ATMOSPHERE_SITE || host.endsWith(`.${ATMOSPHERE_SITE}`)) return ATMOSPHERE_SITE;
  return undefined;
}

type CookieFlags = {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  path: '/';
  domain?: string;
};

function cookieFlags(domain: string | undefined): CookieFlags {
  return {
    httpOnly: true,
    secure: config.cookies.secure,
    sameSite: config.cookies.sameSite,
    path: '/',
    ...(domain ? { domain } : {}),
  };
}

export function setSessionCookies(res: Response, session: Session, publicHost?: string | null): void {
  const domain = sessionCookieDomain(publicHost);
  // A leftover host-only cookie is sent ahead of the parent-domain cookie
  // and would hide the shared session on this host.
  if (domain) {
    const hostOnly = cookieFlags(undefined);
    res.clearCookie(config.cookies.accessTokenName, hostOnly);
    res.clearCookie(config.cookies.refreshTokenName, hostOnly);
  }
  const shared = cookieFlags(domain);
  res.cookie(config.cookies.accessTokenName, session.access_token, {
    ...shared,
    maxAge: config.cookies.accessMaxAgeMs,
  });
  res.cookie(config.cookies.refreshTokenName, session.refresh_token, {
    ...shared,
    maxAge: config.cookies.refreshMaxAgeMs,
  });
}

export function clearSessionCookies(res: Response, publicHost?: string | null): void {
  const hostOnly = cookieFlags(undefined);
  res.clearCookie(config.cookies.accessTokenName, hostOnly);
  res.clearCookie(config.cookies.refreshTokenName, hostOnly);
  const domain = sessionCookieDomain(publicHost);
  if (domain) {
    const shared = cookieFlags(domain);
    res.clearCookie(config.cookies.accessTokenName, shared);
    res.clearCookie(config.cookies.refreshTokenName, shared);
  }
}

/**
 * The device cookie is deliberately *not* cleared on logout: staying enrolled is
 * the entire point of a PIN, so signing out should return the user to the PIN
 * pad rather than the full password form. It is cleared only when the user
 * disables their PIN, when the device is revoked, or after a password reset.
 * It stays host-only. Widening it would let every subdomain enroll the device.
 */
export function setDeviceCookie(res: Response, value: string): void {
  res.cookie(config.device.cookieName, value, {
    ...cookieFlags(undefined),
    maxAge: config.device.cookieMaxAgeMs,
  });
}

export function clearDeviceCookie(res: Response): void {
  res.clearCookie(config.device.cookieName, cookieFlags(undefined));
}
