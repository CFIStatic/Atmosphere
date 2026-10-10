import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { clientIpKeyGenerator } from '../lib/clientIp.js';
import { z } from 'zod';
import { adminForJob, requireAdmin, unscopedAdminOrNull } from '../lib/scopedAdmin.js';
import { HttpError } from '../lib/errors.js';
import {
  PROGRESS_SHARE_COOKIE,
  readShareCookie,
  resolveShareToken,
  setShareCookie,
} from '../lib/shareSession.js';
import { shareState } from '../verifier/library.js';
import { requireAuth } from '../middleware/requireAuth.js';
import {
  claimProgressShareForUser,
  enrichJobProgressGrants,
  listJobProgressGrants,
} from '../shared/jobProgressGrants.js';
import { sendProgressSignInLink, verifyProgressSignIn } from '../auth/progressEmailSignIn.js';
import { setSessionCookies } from '../lib/session.js';
import { publicUser } from '../auth/passwordAccount.js';

/**
 * Guest access to a read-only job file.
 *
 * The token in the URL is the whole credential — no login required, because
 * homeowners, attorneys, banks and insurance adjusters should not need an
 * Atmosphere account to see the job file and every recording on it.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const progressShareRouter = Router();

const shareLimiter = rateLimit({
  keyGenerator: clientIpKeyGenerator,
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests.', code: 'rate_limited' },
});
progressShareRouter.use(shareLimiter);


/** POST /api/progress-share/exchange — token → httpOnly cookie. Path tokens stay valid. */
progressShareRouter.post('/exchange', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = z
      .object({ token: z.string().trim().min(8).max(400) })
      .parse(req.body ?? {}).token;
    await progressShareForToken(token);
    setShareCookie(res, PROGRESS_SHARE_COOKIE, token);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});


async function progressShareForToken(token: string) {
  const raw = requireAdmin();

  const { data: share } = await raw
    .from('verifier_shares')
    .select(
      'id, org_id, job_id, label, recipient_email, expires_at, revoked_at, open_count, share_kind',
    )
    .eq('access_token', token)
    .maybeSingle();

  const state = shareState(share as any);
  if (state === 'missing') throw new HttpError(404, 'This link does not exist.', 'not_found');
  if (state === 'revoked') throw new HttpError(410, 'This link was revoked.', 'revoked');
  if (state === 'expired') throw new HttpError(410, 'This link has expired.', 'expired');
  if ((share as any)?.share_kind !== 'progress') {
    throw new HttpError(404, 'This link does not exist.', 'not_found');
  }

  // Soft-deleted job files invalidate guest media even if the share row lingers.
  const { data: jobRow } = await raw
    .from('crm_jobs')
    .select('id, deleted_at')
    .eq('id', (share as any).job_id)
    .maybeSingle();
  if (!jobRow || (jobRow as any).deleted_at) {
    throw new HttpError(410, 'This job file is no longer available.', 'job_deleted');
  }

  const scoped = adminForJob({ orgId: (share as any).org_id, jobId: (share as any).job_id }, raw);
  return { share: share as any, admin: scoped.raw };
}

function tokenFromProgressRequest(req: Request): string {
  return resolveShareToken(req.params.token, readShareCookie(req, PROGRESS_SHARE_COOKIE));
}



/**
 * POST /api/progress-share/:token/claim
 * Signed-in homeowner with matching email claims the job for /job-progress.
 */
progressShareRouter.post(
  '/:token/claim',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const claimed = await claimProgressShareForUser({
        token: tokenFromProgressRequest(req),
        userId: req.user!.id,
        userEmail: req.user!.email,
      });
      res.json({ ok: true, ...claimed });
    } catch (err) {
      next(err);
    }
  },
);

const signInSendLimiter = rateLimit({
  keyGenerator: clientIpKeyGenerator,
  windowMs: 15 * 60_000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-in emails. Wait a few minutes and try again.', code: 'rate_limited' },
});

const signInVerifyLimiter = rateLimit({
  keyGenerator: clientIpKeyGenerator,
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Wait a few minutes and try again.', code: 'rate_limited' },
});

/**
 * POST /api/progress-share/:token/email-sign-in
 * Emails the share's own recipient a one-time sign-in link + code. No password.
 * The address is never taken from the request, so nothing can be enumerated.
 */
progressShareRouter.post(
  '/:token/email-sign-in',
  signInSendLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await sendProgressSignInLink(tokenFromProgressRequest(req));
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/progress-share/:token/email-sign-in/verify
 * Link token hash or 6-digit code -> session cookies -> claim (same checks as /claim).
 */
progressShareRouter.post(
  '/:token/email-sign-in/verify',
  signInVerifyLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = z
        .object({
          tokenHash: z.string().trim().min(8).max(400).optional(),
          kind: z.enum(['magiclink', 'invite']).optional(),
          code: z.string().trim().regex(/^\d{6,10}$/).optional(),
        })
        .refine((b) => Boolean(b.tokenHash || b.code), 'tokenHash or code required')
        .parse(req.body ?? {});
      const token = tokenFromProgressRequest(req);
      const { session, user } = await verifyProgressSignIn({ shareToken: token, ...body });
      setSessionCookies(res, session, req.hostname);
      const claimed = await claimProgressShareForUser({ token, userId: user.id, userEmail: user.email });
      res.json({ ok: true, user: publicUser(user), ...claimed });
    } catch (err) {
      next(err);
    }
  },
);

/** GET /api/progress-share/grants — jobs this account can open at /job-progress. */
progressShareRouter.get(
  '/grants',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const admin = unscopedAdminOrNull() ?? requireAdmin();
      const grants = await enrichJobProgressGrants(
        admin,
        await listJobProgressGrants(admin, req.user!.id, req.user!.email),
      );
      res.json({
        grants: grants.map((g) => ({
          orgId: g.orgId,
          jobId: g.jobId,
          orgName: g.orgName,
          jobTitle: g.jobTitle,
          status: g.status,
          path: g.path,
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/progress-share/:token/invite
 * What the sign-in page needs to send an invited homeowner into the portal:
 * the invited email (prefilled; the token holder is the invitee), contractor
 * and job title. No job data, no open count. Unknown/revoked tokens 404/410.
 */
const inviteLimiter = rateLimit({
  keyGenerator: clientIpKeyGenerator,
  windowMs: 15 * 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Wait a few minutes and try again.', code: 'rate_limited' },
});

progressShareRouter.get(
  '/:token/invite',
  inviteLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { share, admin } = await progressShareForToken(tokenFromProgressRequest(req));
      const [{ data: org }, { data: job }] = await Promise.all([
        admin.from('orgs').select('name').eq('id', share.org_id).maybeSingle(),
        admin.from('crm_jobs').select('title').eq('id', share.job_id).maybeSingle(),
      ]);
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        recipientEmail: share.recipient_email ?? null,
        orgName: (org as any)?.name ?? 'Your contractor',
        jobTitle: (job as any)?.title ?? null,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * Retired: the anonymous share-data API (job file, Ask, video by token or
 * guest cookie). Homeowners sign in by email and use the portal; a share token
 * alone no longer reads job data. Kept as explicit 410s so old links and
 * clients get a clean answer instead of a fallthrough.
 */
function retiredGuestApi(_req: Request, res: Response) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(410).json({
    error: 'This link now opens in the Atmosphere app. Open it again to sign in.',
    code: 'share_api_retired',
  });
}
progressShareRouter.all('/:token', retiredGuestApi);
progressShareRouter.all('/:token/ask', retiredGuestApi);
progressShareRouter.all('/:token/ask/*', retiredGuestApi);
progressShareRouter.all('/:token/proof/*', retiredGuestApi);
