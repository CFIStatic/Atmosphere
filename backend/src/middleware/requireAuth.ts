import type { NextFunction, Request, Response } from 'express';
import type { User } from '@supabase/supabase-js';
import { config } from '../config.js';
import { createAnonClient } from '../lib/supabase.js';
import { cachedGetUser } from '../lib/authUserCache.js';
import { setSessionCookies, clearSessionCookies } from '../lib/session.js';
import { unauthorized, serviceUnavailable } from '../lib/errors.js';
import { isTransient } from '../lib/upstream.js';
import { isTermsExemptPath } from '../legal/terms.js';
import { assertCurrentTermsAccepted } from '../legal/termsStore.js';
import { createAdminClient } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import { recordUserAction } from '../legal/monitor.js';
import {
  SUPPORT_SID_COOKIE,
  SUPPORT_TOKEN_COOKIE,
  findLiveSessionByCookie,
  isBlockedSupportRequest,
  isSessionLive,
} from '../support/sessions.js';
import { clearSupportCookies, endSupportSession } from '../routes/support.js';

declare global {
   
  namespace Express {
    interface Request {
      user?: User;
      accessToken?: string;
      /** Set while an Analytics staff member is viewing Platform as this user. */
      support?: { sessionId: string; staffUserId: string; staffEmail: string | null; orgId: string };
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
/**
 * Several routers share one mount point (four of them on /api/operations) and
 * each runs requireAuth, so one request used to verify the session and look
 * up the Terms acceptance up to four times in a row. The first pass marks the
 * request; later passes reuse what it established.
 */
const AUTH_DONE = Symbol.for('atmosphere.requireAuth.done');

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if ((req as Request & { [AUTH_DONE]?: boolean })[AUTH_DONE] && req.user) {
    next();
    return;
  }
  try {
    const cookieAccess = req.cookies?.[config.cookies.accessTokenName] as string | undefined;
    const refreshToken = req.cookies?.[config.cookies.refreshTokenName] as string | undefined;
    const accessToken = cookieAccess || bearerAccessToken(req);
    const supabase = createAnonClient();

    // Staff support session ("Open account" from Analytics): host-only cookies
    // on the Platform host take precedence over the staff member's own session.
    if (req.cookies?.[SUPPORT_SID_COOKIE] && !requestPath(req).startsWith('/api/analytics')) {
      if (await applySupportSession(req, res)) {
        markAuthDone(req);
        next();
        return;
      }
    }

    if (accessToken) {
      const { data, error } = await cachedGetUser(accessToken, (token) => supabase.auth.getUser(token));
      if (!error && data.user) {
        req.user = data.user;
        req.accessToken = accessToken;
        await enforceTermsIfRequired(req);
        markAuthDone(req);
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
        setSessionCookies(res, data.session, req.hostname);
        req.user = data.user;
        req.accessToken = data.session.access_token;
        await enforceTermsIfRequired(req);
        markAuthDone(req);
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
    clearSessionCookies(res, req.hostname);
    throw unauthorized();
  } catch (err) {
    next(err);
  }
}

function markAuthDone(req: Request): void {
  (req as Request & { [AUTH_DONE]?: boolean })[AUTH_DONE] = true;
}

function requestPath(req: Request): string {
  return (req.originalUrl || req.url || req.path || '').split('?')[0] ?? '';
}

/**
 * Resolve a live support session to the customer user. Returns false (and
 * clears the support cookies) when there is none, so the request falls back
 * to the caller's own session. Billing writes are refused, never silent.
 */
async function applySupportSession(req: Request, res: Response): Promise<boolean> {
  const admin = createAdminClient();
  const sid = req.cookies?.[SUPPORT_SID_COOKIE] as string | undefined;
  const token = req.cookies?.[SUPPORT_TOKEN_COOKIE] as string | undefined;
  if (!admin || !sid) return false;
  const row = await findLiveSessionByCookie(admin, sid);
  if (!row || !isSessionLive(row) || !token) {
    if (row && !row.ended_at) await endSupportSession(admin, row, token, 'expired');
    clearSupportCookies(res);
    return false;
  }
  const { data, error } = await createAnonClient().auth.getUser(token);
  if (error || !data.user || data.user.id !== row.target_user_id) {
    await endSupportSession(admin, row, token, 'revoked');
    clearSupportCookies(res);
    return false;
  }
  const path = requestPath(req);
  if (isBlockedSupportRequest(req.method, path)) {
    await admin
      .from('staff_support_sessions')
      .update({ blocked_actions: 1 })
      .eq('id', row.id)
      .eq('blocked_actions', 0);
    await recordUserAction({
      actorUserId: row.staff_user_id,
      actorEmail: row.staff_email,
      actorLabel: 'Atmosphere staff (support)',
      orgId: row.org_id,
      action: 'support.billing_blocked',
      resourceType: 'user',
      resourceId: row.target_user_id,
      method: req.method,
      path,
      detail: { supportSessionId: row.id },
    });
    throw new HttpError(
      403,
      'Billing and account changes are turned off while viewing as a customer. Ask the customer to do this, or exit support view.',
      'support_billing_blocked',
    );
  }
  req.user = data.user;
  req.accessToken = token;
  req.support = {
    sessionId: row.id,
    staffUserId: row.staff_user_id,
    staffEmail: row.staff_email,
    orgId: row.org_id,
  };
  return true;
}

async function enforceTermsIfRequired(req: Request): Promise<void> {
  const path = (req.originalUrl || req.url || req.path || '').split('?')[0] ?? '';
  if (isTermsExemptPath(path)) return;
  if (!req.user?.id) return;
  await assertCurrentTermsAccepted(req.user.id, req.accessToken);
}
