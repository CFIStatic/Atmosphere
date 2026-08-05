import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { createAdminClient } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import { proofVideoUrl, recordAccess } from './proofOfWork.js';
import { serializeEvidence, shareState } from '../verifier/library.js';

/**
 * The evidence portal's backend: two doors into one record.
 *
 * (Mounted at /api/evidence-portal — /api/verifier already belongs to the
 * agent-run verifier, which is a different machine with a coincidental name.)
 *
 * The inside door is the org's whole evidence library — every clip on every
 * job, with the integrity verdicts, the analysis, and the custody trail. The
 * outside door is a share: a token scoped to one job, created for a named
 * reviewer, revocable, expiring, and exchanged server-side exactly the way the
 * subcontractor's job link is. No token ever touches PostgREST.
 *
 * The rule both doors obey: reading evidence is itself an event on the
 * evidence. An adjuster opening a clip through a share lands in the same
 * append-only custody log as the PM who uploaded it — under the name the
 * share was issued to, because "someone with the link" is not an entry worth
 * keeping.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const PROOF_BUCKET = 'job-proofs';

const PORTAL_PROOF_SELECT =
  'id, org_id, job_id, party_id, work_date, phase, storage_path, byte_size, duration_seconds, ' +
  'content_hash, captured_at, received_at, lat, lon, accuracy_m, state, checks, ai_summary, ' +
  'ai_findings, ai_model, ai_material_change, analysis_status, legal_hold, retention_until';

export const evidencePortalRouter = Router();

/** The external door, mounted outside auth: the token is the whole credential. */
export const evidenceShareRouter = Router();

const shareLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests.', code: 'rate_limited' },
});
evidenceShareRouter.use(shareLimiter);

/* ------------------------------------------------------------------ *
 * Shared assembly
 * ------------------------------------------------------------------ */

/**
 * Turn proof rows into the library's list shape: names resolved, episode tiers
 * attached, before-rows told whether their day has an after. One code path for
 * both doors, so an adjuster and the PM are looking at literally the same
 * serialization.
 */
async function assembleLibrary(client: any, orgId: string, proofs: any[]) {
  const jobIds = [...new Set(proofs.map((p) => p.job_id))];
  const partyIds = [...new Set(proofs.map((p) => p.party_id).filter(Boolean))];

  const [jobs, parties, episodes] = await Promise.all([
    jobIds.length
      ? client.from('crm_jobs').select('id, title, job_number').in('id', jobIds)
      : Promise.resolve({ data: [] }),
    partyIds.length
      ? client.from('job_parties').select('id, company, contact_name').in('id', partyIds)
      : Promise.resolve({ data: [] }),
    jobIds.length
      ? client
          .from('work_episodes')
          .select('job_id, party_id, work_date, tier')
          .eq('org_id', orgId)
          .in('job_id', jobIds)
      : Promise.resolve({ data: [] }),
  ]);

  const jobById = new Map<string, any>((jobs.data ?? []).map((j: any) => [j.id, j]));
  const partyById = new Map<string, any>((parties.data ?? []).map((p: any) => [p.id, p]));
  const tierByDay = new Map<string, number>(
    (episodes.data ?? []).map((e: any) => [`${e.job_id}|${e.party_id}|${e.work_date}`, e.tier]),
  );
  const daysWithAfter = new Set(
    proofs
      .filter((p) => p.phase === 'after')
      .map((p) => `${p.job_id}|${p.party_id}|${p.work_date}`),
  );

  return proofs.map((proof) => {
    const job = jobById.get(proof.job_id);
    const party = partyById.get(proof.party_id);
    const dayKey = `${proof.job_id}|${proof.party_id}|${proof.work_date}`;
    return serializeEvidence({
      proof,
      jobName: job?.title ?? null,
      jobNumber: job?.job_number ?? null,
      company: party?.company ?? null,
      contactName: party?.contact_name ?? null,
      tier: tierByDay.get(dayKey) ?? null,
      dayHasAfter: daysWithAfter.has(dayKey),
    });
  });
}

/**
 * A before clip's pairing state depends on siblings the caller may not have
 * loaded. Fixed up here rather than special-cased in two routes.
 */
function fixPairing(item: any, siblings: Array<{ phase: string }>) {
  if (item.phase === 'before') {
    item.analysisState = siblings.some((s) => s.phase === 'after') ? 'paired' : 'waiting_on_after';
  }
  return item;
}

/** Signed URLs for the frames the model read. Ten minutes, like the video. */
async function frameUrls(proofId: string) {
  const admin = createAdminClient();
  if (!admin) return [];
  const { data: frames } = await admin
    .from('job_proof_frames')
    .select('at_seconds, storage_path')
    .eq('proof_id', proofId)
    .order('at_seconds');
  const out: Array<{ atSeconds: number; url: string }> = [];
  for (const frame of (frames ?? []) as any[]) {
    const { data } = await admin.storage
      .from(PROOF_BUCKET)
      .createSignedUrl(frame.storage_path, 600);
    if (data?.signedUrl) out.push({ atSeconds: Number(frame.at_seconds), url: data.signedUrl });
  }
  return out;
}

async function custodyFor(client: any, proofId: string) {
  const { data } = await client
    .from('job_evidence_access')
    .select('id, action, actor_label, actor_role, detail, occurred_at')
    .eq('proof_id', proofId)
    .order('occurred_at')
    .limit(200);
  return (data ?? []).map((entry: any) => ({
    id: entry.id,
    action: entry.action,
    by: entry.actor_label,
    role: entry.actor_role,
    detail: entry.detail,
    at: entry.occurred_at,
  }));
}

async function actorLabelFor(supabase: any, userId: string): Promise<string> {
  const { data } = await supabase
    .from('profiles')
    .select('full_name, email')
    .eq('id', userId)
    .maybeSingle();
  return (data as any)?.full_name ?? (data as any)?.email ?? 'Office';
}

/* ------------------------------------------------------------------ *
 * The inside door
 * ------------------------------------------------------------------ */

evidencePortalRouter.use(requireAuth);

/** GET /api/evidence-portal/library — every clip on every job, newest first. */
evidencePortalRouter.get('/library', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, orgId } = await requireOrgContext(req);
    const { data, error } = await supabase
      .from('job_proofs')
      .select(PORTAL_PROOF_SELECT)
      .eq('org_id', orgId)
      .order('received_at', { ascending: false })
      .limit(500);
    if (error) throw new HttpError(500, error.message, 'library_failed');

    const items = await assembleLibrary(supabase, orgId, data ?? []);
    res.json({
      items,
      counts: {
        total: items.length,
        flagged: items.filter((i: any) => i.flagged).length,
        unanalysed: items.filter(
          (i: any) => i.analysisState !== 'done' && i.analysisState !== 'paired',
        ).length,
        onHold: items.filter((i: any) => i.legalHold).length,
      },
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/evidence-portal/evidence/:proofId — one clip, whole. */
evidencePortalRouter.get(
  '/evidence/:proofId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { supabase, orgId } = await requireOrgContext(req);
      const { data: proof, error } = await supabase
        .from('job_proofs')
        .select(PORTAL_PROOF_SELECT)
        .eq('org_id', orgId)
        .eq('id', req.params.proofId)
        .maybeSingle();
      if (error) throw new HttpError(500, error.message, 'evidence_failed');
      if (!proof) throw new HttpError(404, 'No such clip.', 'not_found');

      const { data: siblings } = await supabase
        .from('job_proofs')
        .select('phase')
        .eq('org_id', orgId)
        .eq('job_id', (proof as any).job_id)
        .eq('party_id', (proof as any).party_id)
        .eq('work_date', (proof as any).work_date);

      const items = await assembleLibrary(supabase, orgId, [proof]);
      const item = fixPairing(items[0], (siblings ?? []) as any[]);

      const [custody, frames] = await Promise.all([
        custodyFor(supabase, req.params.proofId),
        frameUrls(req.params.proofId),
      ]);

      res.json({ item, custody, frames });
    } catch (err) {
      next(err);
    }
  },
);

/** GET /api/evidence-portal/evidence/:proofId/video — minted and logged. */
evidencePortalRouter.get('/evidence/:proofId/video', proofVideoUrl);

/* ---- Shares ---- */

/** POST /api/evidence-portal/shares — hand the record to somebody outside. */
evidencePortalRouter.post('/shares', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z
      .object({
        jobId: z.string().uuid(),
        label: z.string().trim().min(2).max(200),
        // Zero means "until revoked" — allowed, but it has to be said.
        expiresInDays: z.number().int().min(0).max(365).default(30),
      })
      .parse(req.body);
    const { supabase, orgId, userId } = await requireOrgContext(req);

    const { data: job } = await supabase
      .from('crm_jobs')
      .select('id, title')
      .eq('org_id', orgId)
      .eq('id', body.jobId)
      .maybeSingle();
    if (!job) throw new HttpError(404, 'No such job.', 'job_not_found');

    const expiresAt =
      body.expiresInDays === 0
        ? null
        : new Date(Date.now() + body.expiresInDays * 86_400_000).toISOString();

    const { data: share, error } = await supabase
      .from('verifier_shares')
      .insert({
        org_id: orgId,
        job_id: body.jobId,
        label: body.label,
        created_by: userId,
        expires_at: expiresAt,
      })
      .select('id, access_token, label, expires_at, created_at')
      .single();
    if (error) throw new HttpError(400, error.message, 'share_failed');

    // Sharing evidence is an act on the evidence, and it goes on the record
    // under the sharer's name with the recipient's label in the detail.
    await recordAccess(supabase, {
      orgId,
      jobId: body.jobId,
      action: 'shared',
      actorId: userId,
      actorLabel: await actorLabelFor(supabase, userId),
      actorRole: 'general_contractor',
      detail: `Verifier link issued to ${body.label}${
        expiresAt ? `, expires ${expiresAt.slice(0, 10)}` : ', no expiry'
      }`,
    });

    res.status(201).json({
      share: {
        id: (share as any).id,
        label: (share as any).label,
        expiresAt: (share as any).expires_at,
        createdAt: (share as any).created_at,
        path: `/verifier/shared/${(share as any).access_token}`,
      },
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/evidence-portal/shares?jobId= — the outstanding links. */
evidencePortalRouter.get('/shares', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = z.object({ jobId: z.string().uuid().optional() }).parse(req.query);
    const { supabase, orgId } = await requireOrgContext(req);
    let query = supabase
      .from('verifier_shares')
      .select(
        'id, job_id, label, access_token, created_at, expires_at, revoked_at, last_opened_at, open_count',
      )
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (jobId) query = query.eq('job_id', jobId);
    const { data, error } = await query;
    if (error) throw new HttpError(500, error.message, 'shares_failed');

    res.json({
      shares: (data ?? []).map((row: any) => ({
        id: row.id,
        jobId: row.job_id,
        label: row.label,
        path: `/verifier/shared/${row.access_token}`,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
        lastOpenedAt: row.last_opened_at,
        openCount: row.open_count,
        state: shareState(row),
      })),
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/evidence-portal/shares/:id/revoke — the link dies now. */
evidencePortalRouter.post(
  '/shares/:id/revoke',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { supabase, orgId, userId } = await requireOrgContext(req);
      const { data: share } = await supabase
        .from('verifier_shares')
        .select('id, job_id, label, revoked_at')
        .eq('org_id', orgId)
        .eq('id', req.params.id)
        .maybeSingle();
      if (!share) throw new HttpError(404, 'No such share.', 'not_found');
      if ((share as any).revoked_at) {
        throw new HttpError(409, 'Already revoked.', 'already_revoked');
      }

      const { error } = await supabase
        .from('verifier_shares')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', req.params.id);
      if (error) throw new HttpError(400, error.message, 'revoke_failed');

      await recordAccess(supabase, {
        orgId,
        jobId: (share as any).job_id,
        action: 'released',
        actorId: userId,
        actorLabel: await actorLabelFor(supabase, userId),
        actorRole: 'general_contractor',
        detail: `Verifier link for ${(share as any).label} revoked`,
      });

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

/* ------------------------------------------------------------------ *
 * The outside door
 * ------------------------------------------------------------------ */

/**
 * Exchange a token for its share, with the reason a dead one is dead. Admin
 * client throughout — the anonymous caller has no PostgREST identity, which is
 * the entire design.
 */
async function shareForToken(token: string) {
  const admin = createAdminClient();
  if (!admin) throw new HttpError(503, 'Sharing is not configured on this server.', 'no_admin');

  const { data: share } = await admin
    .from('verifier_shares')
    .select('id, org_id, job_id, label, expires_at, revoked_at, open_count')
    .eq('access_token', token)
    .maybeSingle();

  const state = shareState(share as any);
  // Revoked and expired are told apart on purpose: they prompt different
  // phone calls from the person holding the dead link.
  if (state === 'missing') throw new HttpError(404, 'This link does not exist.', 'not_found');
  if (state === 'revoked') throw new HttpError(410, 'This link was revoked.', 'revoked');
  if (state === 'expired') throw new HttpError(410, 'This link has expired.', 'expired');

  return { share: share as any, admin };
}

/** GET /api/verifier-share/:token — the job's evidence, for the link holder. */
evidenceShareRouter.get('/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { share, admin } = await shareForToken(req.params.token);

    const [{ data: job }, { data: proofs, error }] = await Promise.all([
      admin
        .from('crm_jobs')
        .select('id, title, job_number, claim_number')
        .eq('id', share.job_id)
        .maybeSingle(),
      admin
        .from('job_proofs')
        .select(PORTAL_PROOF_SELECT)
        .eq('job_id', share.job_id)
        .order('received_at', { ascending: false })
        .limit(500),
    ]);
    if (error) throw new HttpError(500, error.message, 'shared_failed');

    // The open is bookkeeping on the share; the per-clip custody trail stays
    // clean until a specific clip is actually looked at.
    await admin
      .from('verifier_shares')
      .update({
        last_opened_at: new Date().toISOString(),
        open_count: (share.open_count ?? 0) + 1,
      })
      .eq('id', share.id);

    const items = await assembleLibrary(admin, share.org_id, proofs ?? []);
    res.json({
      share: { label: share.label, expiresAt: share.expires_at },
      job: job
        ? {
            id: (job as any).id,
            title: (job as any).title,
            number: (job as any).job_number,
            claimNumber: (job as any).claim_number,
          }
        : null,
      items,
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/verifier-share/:token/evidence/:proofId — one clip, logged. */
evidenceShareRouter.get(
  '/:token/evidence/:proofId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { share, admin } = await shareForToken(req.params.token);

      const { data: proof } = await admin
        .from('job_proofs')
        .select(PORTAL_PROOF_SELECT)
        .eq('job_id', share.job_id) // the scope: never a clip from another job
        .eq('id', req.params.proofId)
        .maybeSingle();
      if (!proof) throw new HttpError(404, 'No such clip on this job.', 'not_found');

      const { data: siblings } = await admin
        .from('job_proofs')
        .select('phase')
        .eq('job_id', share.job_id)
        .eq('party_id', (proof as any).party_id)
        .eq('work_date', (proof as any).work_date);

      const items = await assembleLibrary(admin, share.org_id, [proof]);
      const item = fixPairing(items[0], (siblings ?? []) as any[]);

      // Opening the detail is seeing the frames and the analysis — that is a
      // view, under the name the link was issued to.
      await recordAccess(admin, {
        orgId: share.org_id,
        jobId: share.job_id,
        proofId: req.params.proofId,
        action: 'viewed',
        actorLabel: share.label,
        actorRole: 'external_reviewer',
        detail: 'via Verifier link — frames and analysis',
      });

      const [custody, frames] = await Promise.all([
        custodyFor(admin, req.params.proofId),
        frameUrls(req.params.proofId),
      ]);

      res.json({ item, custody, frames });
    } catch (err) {
      next(err);
    }
  },
);

/** GET /api/verifier-share/:token/evidence/:proofId/video — the file itself. */
evidenceShareRouter.get(
  '/:token/evidence/:proofId/video',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { share, admin } = await shareForToken(req.params.token);

      const { data: proof } = await admin
        .from('job_proofs')
        .select('id, storage_path, phase, work_date')
        .eq('job_id', share.job_id)
        .eq('id', req.params.proofId)
        .maybeSingle();
      if (!proof) throw new HttpError(404, 'No such clip on this job.', 'not_found');

      const { data, error } = await admin.storage
        .from(PROOF_BUCKET)
        .createSignedUrl((proof as any).storage_path, 600);
      if (error) throw new HttpError(500, error.message, 'signed_url_failed');

      await recordAccess(admin, {
        orgId: share.org_id,
        jobId: share.job_id,
        proofId: req.params.proofId,
        action: 'viewed',
        actorLabel: share.label,
        actorRole: 'external_reviewer',
        detail: `via Verifier link — original video, ${(proof as any).phase} · ${(proof as any).work_date}`,
      });

      res.json({ url: (data as any).signedUrl, expiresInSeconds: 600 });
    } catch (err) {
      next(err);
    }
  },
);
