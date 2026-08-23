import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { createAdminClient } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import { shareState } from '../verifier/library.js';
import { parseMediaDuration } from '../verification/frames/duration.js';
import { buildJobProofPayload, PROOF_BUCKET, recordAccess } from './proofOfWork.js';

/**
 * Guest access to a read-only job progress dashboard.
 *
 * The token in the URL is the whole credential — no login required, because
 * homeowners, attorneys, banks and insurance adjusters should not need an
 * Atmosphere account to see how work is advancing.
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

async function progressShareForToken(token: string) {
  const admin = createAdminClient();
  if (!admin) throw new HttpError(503, 'Sharing is not configured on this server.', 'no_admin');

  const { data: share } = await admin
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

  return { share: share as any, admin };
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

/** GET /api/progress-share/:token — read-only job progress for third parties. */
progressShareRouter.get('/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { share, admin } = await progressShareForToken(req.params.token);

    const [{ data: job }, { data: org }, { data: scopeRows }, proof] = await Promise.all([
      admin
        .from('crm_jobs')
        .select('id, title, job_number, claim_number, status')
        .eq('id', share.job_id)
        .maybeSingle(),
      admin.from('orgs').select('name').eq('id', share.org_id).maybeSingle(),
      admin
        .from('job_scope_items')
        .select('id, state, title')
        .eq('job_id', share.job_id)
        .order('created_at'),
      buildJobProofPayload(admin, share.org_id, share.job_id),
    ]);

    await admin
      .from('verifier_shares')
      .update({
        last_opened_at: new Date().toISOString(),
        open_count: (share.open_count ?? 0) + 1,
      })
      .eq('id', share.id);

    const scope = (scopeRows ?? []) as any[];

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
      progress: progressFromRecord(scope, proof),
      proof,
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/progress-share/:token/proof/:proofId/video — watch a clip through the share. */
progressShareRouter.get(
  '/:token/proof/:proofId/video',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { share, admin } = await progressShareForToken(req.params.token);

      const { data: proof } = await admin
        .from('job_proofs')
        .select('id, storage_path, job_id, work_date, phase, duration_seconds')
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

      res.json({
        url: (data as any).signedUrl,
        expiresInSeconds: 600,
        durationSeconds: parseMediaDuration((proof as any).duration_seconds),
      });
    } catch (err) {
      next(err);
    }
  },
);
