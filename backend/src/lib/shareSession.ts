/**
 * Guest-share cookies.
 *
 * Job-share and progress-share tokens used to live only in the URL
 * (`/shared/:token`, `/fieldcapture/?token=`, `/progress/:token`). That leaks
 * through Referer, history, and screenshots. These helpers mint an httpOnly
 * cookie after a one-time exchange so subsequent API calls can omit the
 * token from the path.
 *
 * Path tokens stay valid: Field Capture (web + iOS) still sends them. The
 * cookie is an additional credential, not a replacement.
 */

import type { Request, Response } from 'express';
import { config } from '../config.js';

export const JOB_SHARE_COOKIE = 'atm_job_share';
export const PROGRESS_SHARE_COOKIE = 'atm_progress_share';

const cookieBase = {
  httpOnly: true,
  secure: config.cookies.secure,
  sameSite: config.cookies.sameSite,
  domain: config.cookies.domain,
  path: '/',
} as const;

/** Guest shares last a working day, not a month. */
const SHARE_COOKIE_MS = 12 * 60 * 60 * 1000;

export function setShareCookie(
  res: Response,
  name: typeof JOB_SHARE_COOKIE | typeof PROGRESS_SHARE_COOKIE,
  token: string,
): void {
  res.cookie(name, token, {
    ...cookieBase,
    maxAge: SHARE_COOKIE_MS,
  });
}

export function clearShareCookie(
  res: Response,
  name: typeof JOB_SHARE_COOKIE | typeof PROGRESS_SHARE_COOKIE,
): void {
  res.clearCookie(name, { ...cookieBase });
}

export function readShareCookie(
  req: Request,
  name: typeof JOB_SHARE_COOKIE | typeof PROGRESS_SHARE_COOKIE,
): string {
  const raw = req.cookies?.[name];
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * Prefer an explicit path/body token (Field Capture, emailed links). Fall
 * back to the httpOnly cookie after a browser has exchanged.
 */
/**
 * `/api/job-share/session/proof` captures token="session" on the greedy
 * action pattern. That sentinel means "use the cookie", not a real invite.
 */
export const SHARE_SESSION_SENTINEL = 'session';

export function resolveShareToken(
  explicit: string | undefined,
  cookie: string,
): string {
  const fromPath = (explicit ?? '').trim();
  if (fromPath && fromPath !== SHARE_SESSION_SENTINEL) return fromPath;
  return cookie;
}
