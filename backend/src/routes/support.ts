import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { createAdminClient, createAnonClient } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import { recordUserAction } from '../legal/monitor.js';
import {
  HANDOFF_MS,
  SUPPORT_SESSION_MS,
  SUPPORT_SID_COOKIE,
  SUPPORT_TOKEN_COOKIE,
  findLiveSessionByCookie,
  isSessionLive,
  newOpaqueToken,
  openToken,
  sealToken,
  sha256Hex,
} from '../support/sessions.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

function adminOrThrow() {
  const admin = createAdminClient();
  if (!admin) throw new HttpError(503, 'Support access needs the server service key.', 'no_admin');
  return admin;
}

function sealSecret(): string {
  const s = config.supabase.serviceRoleKey;
  if (!s) throw new HttpError(503, 'Support access needs the server service key.', 'no_admin');
  return s;
}

function supportCookieFlags(maxAgeMs: number) {
  // Host-only (no Domain): only the Platform host carries the support session,
  // so the staff member's own session on Analytics is never replaced.
  return {
    httpOnly: true,
    secure: config.cookies.secure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: Math.max(0, maxAgeMs),
  };
}

export function clearSupportCookies(res: Response): void {
  const flags = { httpOnly: true, secure: config.cookies.secure, sameSite: 'lax' as const, path: '/' };
  res.clearCookie(SUPPORT_SID_COOKIE, flags);
  res.clearCookie(SUPPORT_TOKEN_COOKIE, flags);
}

/** Revoke the customer session minted for support (best effort) and close the row. */
export async function endSupportSession(
  admin: any,
  row: { id: string; org_id: string; target_user_id: string; staff_user_id: string },
  accessToken: string | undefined,
  reason: 'exit' | 'expired' | 'revoked',
): Promise<void> {
  if (accessToken) {
    try {
      await admin.auth.admin.signOut(accessToken, 'local');
    } catch {
      /* the token also dies on its own within the hour */
    }
  }
  await admin
    .from('staff_support_sessions')
    .update({ ended_at: new Date().toISOString(), end_reason: reason, handoff_hash: null, handoff_token_enc: null })
    .eq('id', row.id)
    .is('ended_at', null);
  await recordUserAction({
    actorUserId: row.staff_user_id,
    actorLabel: 'Atmosphere staff',
    orgId: row.org_id,
    action: 'support.session_ended',
    resourceType: 'user',
    resourceId: row.target_user_id,
    detail: { supportSessionId: row.id, reason },
  });
}

const createSchema = z.object({
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Mounted at /api/analytics/support-sessions behind requireAuth +
 * requireAnalytics('internal').
 */
export const staffSupportRouter = Router();

/** POST — open a support session as one user in one workspace. */
staffSupportRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createSchema.parse(req.body ?? {});
    const staff = req.user!;
    const admin = adminOrThrow();

    const { data: member } = await admin
      .from('org_members')
      .select('user_id, status')
      .eq('org_id', input.orgId)
      .eq('user_id', input.userId)
      .maybeSingle();
    if (!member) throw new HttpError(404, 'That person is not in this workspace.', 'not_a_member');
    if (input.userId === staff.id) {
      throw new HttpError(400, 'Open your own account from Platform directly.', 'self_support');
    }

    const { data: target, error: targetErr } = await admin.auth.admin.getUserById(input.userId);
    const email = target?.user?.email;
    if (targetErr || !email) throw new HttpError(404, 'That account has no email sign-in.', 'no_email');

    // Mint a customer session server-side. generateLink sends no email.
    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    const hashed = (link.data as any)?.properties?.hashed_token as string | undefined;
    if (link.error || !hashed) throw new HttpError(502, 'Could not open that account.', 'support_mint_failed');
    const verified = await createAnonClient().auth.verifyOtp({ type: 'magiclink', token_hash: hashed });
    const accessToken = verified.data.session?.access_token;
    if (verified.error || !accessToken) {
      throw new HttpError(502, 'Could not open that account.', 'support_mint_failed');
    }

    const code = newOpaqueToken();
    const now = Date.now();
    const { data: row, error } = await admin
      .from('staff_support_sessions')
      .insert({
        staff_user_id: staff.id,
        staff_email: staff.email ?? null,
        target_user_id: input.userId,
        target_email: email,
        org_id: input.orgId,
        reason: input.reason || null,
        expires_at: new Date(now + SUPPORT_SESSION_MS).toISOString(),
        handoff_hash: sha256Hex(code),
        handoff_expires_at: new Date(now + HANDOFF_MS).toISOString(),
        handoff_token_enc: sealToken(accessToken, sealSecret()),
      })
      .select('id, expires_at')
      .single();
    if (error || !row) throw new HttpError(500, 'Could not record the support session.', 'support_record_failed');

    await recordUserAction({
      actorUserId: staff.id,
      actorLabel: staff.email ?? 'Atmosphere staff',
      orgId: input.orgId,
      action: 'support.session_opened',
      resourceType: 'user',
      resourceId: input.userId,
      detail: { supportSessionId: row.id, reason: input.reason ?? null },
    });

    res.status(201).json({
      sessionId: row.id,
      expiresAt: row.expires_at,
      openUrl: `${config.support.platformUrl}/api/support/enter?code=${encodeURIComponent(code)}`,
    });
  } catch (err) {
    if (err instanceof z.ZodError) next(new HttpError(400, err.issues[0]?.message ?? 'Invalid request', 'invalid_request'));
    else next(err);
  }
});

/** GET ?orgId= — the support-access audit trail. */
staffSupportRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const admin = adminOrThrow();
    let q = admin
      .from('staff_support_sessions')
      .select('id, staff_email, target_user_id, target_email, org_id, reason, created_at, expires_at, entered_at, ended_at, end_reason, blocked_actions')
      .order('created_at', { ascending: false })
      .limit(200);
    const orgId = typeof req.query.orgId === 'string' ? req.query.orgId : '';
    if (orgId) q = q.eq('org_id', z.string().uuid().parse(orgId));
    const { data, error } = await q;
    if (error) throw new HttpError(500, error.message, 'support_list_failed');
    res.json({ sessions: data ?? [] });
  } catch (err) {
    next(err);
  }
});

/** Mounted at /api/support on the Platform origin. No requireAuth. */
export const supportRouter = Router();

/** GET /enter?code= — redeem the one-time handoff, set host-only cookies. */
supportRouter.get('/enter', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code) throw new HttpError(400, 'Missing code.', 'missing_code');
    const admin = adminOrThrow();
    const nowIso = new Date().toISOString();
    const sid = newOpaqueToken();
    // Single use: the update only matches an unredeemed, unexpired handoff.
    const { data: row } = await admin
      .from('staff_support_sessions')
      .update({ entered_at: nowIso, handoff_hash: null, cookie_hash: sha256Hex(sid) })
      .eq('handoff_hash', sha256Hex(code))
      .gt('handoff_expires_at', nowIso)
      .is('entered_at', null)
      .is('ended_at', null)
      .select('id, org_id, staff_user_id, target_user_id, expires_at, handoff_token_enc')
      .maybeSingle();
    if (!row || !row.handoff_token_enc) {
      res.status(410).type('text/plain').send('This support link has expired or was already used. Open the account again from Atmosphere Analytics.');
      return;
    }
    const token = openToken(row.handoff_token_enc as string, sealSecret());
    await admin.from('staff_support_sessions').update({ handoff_token_enc: null }).eq('id', row.id);

    const ttl = Date.parse(row.expires_at as string) - Date.now();
    res.cookie(SUPPORT_SID_COOKIE, sid, supportCookieFlags(ttl));
    res.cookie(SUPPORT_TOKEN_COOKIE, token, supportCookieFlags(ttl));
    await recordUserAction({
      actorUserId: row.staff_user_id as string,
      actorLabel: 'Atmosphere staff',
      orgId: row.org_id as string,
      action: 'support.session_entered',
      resourceType: 'user',
      resourceId: row.target_user_id as string,
      detail: { supportSessionId: row.id },
    });
    res.redirect(302, '/');
  } catch (err) {
    next(err);
  }
});

/** GET /session — what the Platform banner shows. */
supportRouter.get('/session', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sid = req.cookies?.[SUPPORT_SID_COOKIE] as string | undefined;
    if (!sid) {
      res.json({ active: false });
      return;
    }
    const admin = adminOrThrow();
    const row = await findLiveSessionByCookie(admin, sid);
    if (!row || !isSessionLive(row)) {
      if (row && !row.ended_at) await endSupportSession(admin, row, req.cookies?.[SUPPORT_TOKEN_COOKIE], 'expired');
      clearSupportCookies(res);
      res.json({ active: false });
      return;
    }
    const [{ data: org }, { data: profile }] = await Promise.all([
      admin.from('orgs').select('name').eq('id', row.org_id).maybeSingle(),
      admin.from('profiles').select('full_name, email').eq('id', row.target_user_id).maybeSingle(),
    ]);
    res.json({
      active: true,
      sessionId: row.id,
      orgId: row.org_id,
      orgName: (org as any)?.name ?? 'this workspace',
      userName: (profile as any)?.full_name || (profile as any)?.email || row.target_email || 'this user',
      userEmail: row.target_email,
      staffEmail: row.staff_email,
      expiresAt: row.expires_at,
    });
  } catch (err) {
    next(err);
  }
});

/** POST /exit — end the support session and revoke the customer token. */
supportRouter.post('/exit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sid = req.cookies?.[SUPPORT_SID_COOKIE] as string | undefined;
    if (sid) {
      const admin = adminOrThrow();
      const row = await findLiveSessionByCookie(admin, sid);
      if (row && !row.ended_at) await endSupportSession(admin, row, req.cookies?.[SUPPORT_TOKEN_COOKIE], 'exit');
    }
    clearSupportCookies(res);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
