import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { adminForJob, requireAdmin } from '../lib/scopedAdmin.js';
import { HttpError } from '../lib/errors.js';
import {
  PROGRESS_SHARE_COOKIE,
  readShareCookie,
  resolveShareToken,
  setShareCookie,
} from '../lib/shareSession.js';
import { shareState } from '../verifier/library.js';
import { homeownerJobFileFromRows } from '../verifier/homeownerJobFile.js';
import { redactProofDeviceIdentity } from '../shared/deviceIdentity.js';
import { buildJobProofPayload, PROOF_BUCKET, recordAccess, runProofAsk } from './proofOfWork.js';

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
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests.', code: 'rate_limited' },
});
progressShareRouter.use(shareLimiter);

/** GET /api/progress-share/session — cookie only, so the token can leave the URL. */
progressShareRouter.get('/session', async (req: Request, res: Response, next: NextFunction) => {
  req.params.token = '';
  return sendProgressGuest(req, res, next);
});

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

const askLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many questions. Wait a minute and try again.', code: 'rate_limited' },
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

  const scoped = adminForJob({ orgId: (share as any).org_id, jobId: (share as any).job_id }, raw);
  return { share: share as any, admin: scoped.raw };
}

function tokenFromProgressRequest(req: Request): string {
  return resolveShareToken(req.params.token, readShareCookie(req, PROGRESS_SHARE_COOKIE));
}

function progressFromRecord(scope: any[], proof: Awaited<ReturnType<typeof buildJobProofPayload>>) {
  const actionable = scope.filter((item) => item.state !== 'excluded');
  const scopeApproved = actionable.filter((item) => item.state === 'approved').length;
  const scopePct = actionable.length
    ? Math.round((scopeApproved / actionable.length) * 100)
    : 0;
  const verifiedDays = proof.days.filter((d) => d.payable || d.accepted).length;
  const inProgress = proof.days.filter((d) => d.hasBefore && !d.hasAfter).length;

  return {
    scopePct,
    scopeApproved,
    scopeTotal: actionable.length,
    daysLogged: proof.counts.days,
    verifiedDays,
    inProgress,
  };
}

async function sendProgressGuest(req: Request, res: Response, next: NextFunction) {
  try {
    const token = tokenFromProgressRequest(req);
    if (!token) throw new HttpError(401, 'No progress-share session.', 'no_share_session');
    const { share, admin } = await progressShareForToken(token);

    const [{ data: job }, { data: org }, { data: scopeRows }, { data: briefRows }, proof] =
      await Promise.all([
        admin
          .from('crm_jobs')
          .select('id, title, job_number, claim_number, status')
          .eq('id', share.job_id)
          .maybeSingle(),
        admin.from('orgs').select('name').eq('id', share.org_id).maybeSingle(),
        admin
          .from('job_scope_items')
          .select('id, party_id, state, title, detail, reason, revision, decided_at, created_at')
          .eq('job_id', share.job_id)
          .order('created_at'),
        admin
          .from('job_briefs')
          .select('id, revision, facts, note')
          .eq('job_id', share.job_id)
          .order('revision', { ascending: false })
          .limit(1),
        buildJobProofPayload(admin, share.org_id, share.job_id).then(redactProofDeviceIdentity),
      ]);

    await admin
      .from('verifier_shares')
      .update({
        last_opened_at: new Date().toISOString(),
        open_count: (share.open_count ?? 0) + 1,
      })
      .eq('id', share.id);

    const scope = (scopeRows ?? []) as any[];
    const jobFile = homeownerJobFileFromRows({
      brief: (briefRows ?? [])[0] ?? null,
      scope,
    });

    res.json({
      share: {
        label: share.label,
        expiresAt: share.expires_at,
        recipientEmail: share.recipient_email ?? null,
      },
      org: { name: (org as any)?.name ?? 'Contractor' },
      job: job
        ? {
            id: (job as any).id,
            title: (job as any).title,
            jobNumber: (job as any).job_number,
            claimNumber: (job as any).claim_number,
            status: (job as any).status,
          }
        : null,
      brief: jobFile.brief,
      scope: jobFile.scope,
      progress: progressFromRecord(scope, proof),
      proof,
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/progress-share/:token — read-only job progress for third parties. */
progressShareRouter.get('/:token', sendProgressGuest);

/**
 * POST /api/progress-share/:token/ask
 * Homeowner (or counsel / bank / adjuster) asks the same job file the office Ask
 * reads — token is the credential, no Atmosphere account.
 */
progressShareRouter.post(
  '/:token/ask',
  askLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { share, admin } = await progressShareForToken(tokenFromProgressRequest(req));
      const input = z.object({ question: z.string().trim().min(3).max(1000) }).parse(req.body ?? {});
      const result = await runProofAsk({
        supabase: admin,
        orgId: share.org_id,
        jobId: share.job_id,
        question: input.question,
        userId: null,
        requestId: `ask:progress:${share.id}:${randomUUID()}`,
      });

      await recordAccess(admin, {
        orgId: share.org_id,
        jobId: share.job_id,
        action: 'viewed',
        actorLabel: `${share.label} — asked via job-file link`,
        actorRole: 'external_reviewer',
        detail: input.question.slice(0, 160),
      });

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

/** GET /api/progress-share/:token/proof/:proofId/video — watch a clip through the share. */
progressShareRouter.get(
  '/:token/proof/:proofId/video',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { share, admin } = await progressShareForToken(tokenFromProgressRequest(req));

      const { data: proof } = await admin
        .from('job_proofs')
        .select('id, storage_path, job_id, work_date, phase')
        .eq('job_id', share.job_id)
        .eq('id', req.params.proofId)
        .maybeSingle();
      if (!proof) throw new HttpError(404, 'No such video on this job.', 'not_found');

      const { data, error } = await admin.storage
        .from(PROOF_BUCKET)
        .createSignedUrl((proof as any).storage_path, 600);
      if (error) throw new HttpError(500, error.message, 'signed_url_failed');

      await recordAccess(admin, {
        orgId: share.org_id,
        jobId: share.job_id,
        proofId: req.params.proofId,
        action: 'viewed',
        actorLabel: `${share.label} — progress link`,
        actorRole: 'external_reviewer',
        detail: `via progress link — ${(proof as any).phase} · ${(proof as any).work_date}`,
      });

      res.json({ url: (data as any).signedUrl, expiresInSeconds: 600 });
    } catch (err) {
      next(err);
    }
  },
);
