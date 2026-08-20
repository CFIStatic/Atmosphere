import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { createAdminClient } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import { proofVideoUrl, recordAccess } from './proofOfWork.js';
import {
  downloadDecision,
  serializeEvidence,
  shareRecipientAllowed,
  shareState,
} from '../verifier/library.js';
import { jobTitleForIntake } from '../verifier/intakePropose.js';
import { shareEmail } from '../verifier/shareEmail.js';
import { progressShareEmail } from '../verifier/progressShareEmail.js';
import { buildMailSender } from '../campaigns/mail/index.js';
import { config } from '../config.js';
import { publicAppOrigin } from '../lib/publicAppOrigin.js';
import { sortJobsForOpen, todayKey } from '../field/todayJobs.js';

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
  'ai_findings, ai_model, ai_material_change, analysis_status, legal_hold, retention_until, labels, ' +
  'narration, narration_text, narration_status, narration_error, actions';

export const evidencePortalRouter = Router();

/**
 * The external door. The token scopes *what* can be seen; a signed-in
 * Atmosphere account is *who* is seeing it — both are required. That trade
 * (an account, for access) is deliberate: it puts a verified identity on
 * every custody entry instead of "whoever held the link", and every adjuster
 * and attorney who reviews evidence ends up inside Atmosphere.
 */
export const evidenceShareRouter = Router();
evidenceShareRouter.use(requireAuth);

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

/** GET /api/evidence-portal/library — every job file, plus every clip, newest first. */
evidencePortalRouter.get('/library', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { q } = z.object({ q: z.string().max(120).optional() }).parse(req.query);
    const { supabase, orgId } = await requireOrgContext(req);
    const { data, error } = await supabase
      .from('job_proofs')
      .select(PORTAL_PROOF_SELECT)
      .eq('org_id', orgId)
      .order('received_at', { ascending: false })
      .limit(500);
    if (error) throw new HttpError(500, error.message, 'library_failed');

    let items = await assembleLibrary(supabase, orgId, data ?? []);
    if (q?.trim()) {
      // The labels are the index; names and hashes come along because that is
      // what a person actually types. Substring, case-blind, in memory — 500
      // serialized rows is small, and the GIN index earns its keep on the
      // database-side queries analytics will run, not here.
      const needle = q.trim().toLowerCase();
      items = items.filter((item: any) =>
        [...(item.labels ?? []), item.jobName, item.company, item.person, item.hash, item.phase]
          .filter(Boolean)
          .some((hay: string) => hay.toLowerCase().includes(needle)),
      );
    }

    // Job files exist before any clip does — Start a job should show the
    // name on the Dashboard so footage has a folder to land in.
    let jobs: Array<{
      jobId: string;
      jobName: string;
      jobNumber: number | null;
      createdAt?: string | null;
    }> = [];
    const { data: jobRows, error: jobsError } = await supabase
      .from('crm_jobs')
      .select('id, title, job_number, created_at, property_id')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (jobsError) {
      console.warn('[library] crm_jobs unavailable:', jobsError.message);
    } else {
      const propertyIds = [
        ...new Set(
          ((jobRows ?? []) as any[])
            .map((j) => j.property_id as string | null)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const addrByProperty = new Map<string, string>();
      if (propertyIds.length) {
        const { data: props, error: propsError } = await supabase
          .from('crm_properties')
          .select('id, address_line1')
          .in('id', propertyIds);
        if (propsError) {
          console.warn('[library] crm_properties unavailable:', propsError.message);
        } else {
          for (const p of (props ?? []) as any[]) {
            if (p.id && p.address_line1) addrByProperty.set(p.id, String(p.address_line1));
          }
        }
      }
      jobs = ((jobRows ?? []) as any[]).map((j) => ({
        jobId: j.id as string,
        jobName: jobTitleForIntake(j.title, addrByProperty.get(j.property_id) ?? ''),
        jobNumber: (j.job_number as number | null) ?? null,
        createdAt: (j.created_at as string | null) ?? null,
      }));
    }
    const seen = new Set(jobs.map((j) => j.jobId));
    for (const item of items) {
      const id = (item as any).jobId as string | undefined;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      jobs.push({
        jobId: id,
        jobName: ((item as any).jobName as string) || 'Job',
        jobNumber: ((item as any).jobNumber as number | null) ?? null,
        createdAt: ((item as any).uploadedAt as string | null) ?? null,
      });
    }

    const lastWorkDateByJob = new Map<string, string>();
    for (const item of items) {
      const id = (item as any).jobId as string | undefined;
      const workDate = (item as any).workDate as string | undefined;
      if (!id || !workDate) continue;
      const prev = lastWorkDateByJob.get(id);
      if (!prev || workDate > prev) lastWorkDateByJob.set(id, workDate);
    }
    jobs = sortJobsForOpen(jobs, lastWorkDateByJob, todayKey());

    res.json({
      items,
      jobs: jobs.map(({ jobId, jobName, jobNumber }) => ({ jobId, jobName, jobNumber })),
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

/**
 * GET /api/evidence-portal/evidence/:proofId/download
 *
 * The org keeping a copy of its own evidence. Free — it is their record —
 * but still a ledger row and a custody entry, because "who has a copy of
 * this clip outside the portal" is a question the org will one day be asked
 * under oath, and the answer should be a query.
 */
evidencePortalRouter.get(
  '/evidence/:proofId/download',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { supabase, orgId, userId } = await requireOrgContext(req);
      const { data: proof } = await supabase
        .from('job_proofs')
        .select('id, job_id, storage_path, phase, work_date')
        .eq('org_id', orgId)
        .eq('id', req.params.proofId)
        .maybeSingle();
      if (!proof) throw new HttpError(404, 'No such clip.', 'not_found');

      const admin = createAdminClient();
      if (!admin) throw new HttpError(503, 'Storage is not configured.', 'no_admin');

      const decision = downloadDecision({ isOrgMember: true, feeCents: 0, ledgerStatus: null });
      // Always 'mint' for a member; asserted so a future edit that breaks the
      // rule fails loudly here rather than quietly charging the org.
      if (decision.action !== 'mint') throw new HttpError(500, 'Download rule broke.', 'rule_broken');

      await admin.from('evidence_downloads').insert({
        org_id: orgId,
        proof_id: (proof as any).id,
        requested_by: userId,
        requester_email: req.user?.email ?? '',
        fee_cents: 0,
        status: 'waived',
        paid_via: 'org_member',
        paid_at: new Date().toISOString(),
      });

      const { data, error } = await admin.storage
        .from(PROOF_BUCKET)
        .createSignedUrl((proof as any).storage_path, 600, { download: true });
      if (error) throw new HttpError(500, error.message, 'signed_url_failed');

      await recordAccess(supabase, {
        orgId,
        jobId: (proof as any).job_id,
        proofId: (proof as any).id,
        action: 'downloaded',
        actorId: userId,
        actorLabel: await actorLabelFor(supabase, userId),
        actorRole: 'general_contractor',
        detail: `original file · ${(proof as any).phase} · ${(proof as any).work_date}`,
      });

      res.json({ url: (data as any).signedUrl, expiresInSeconds: 600 });
    } catch (err) {
      next(err);
    }
  },
);

/* ---- Shares ---- */

/** POST /api/evidence-portal/shares — hand the record to somebody outside. */
evidencePortalRouter.post('/shares', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z
      .object({
        jobId: z.string().uuid(),
        label: z.string().trim().min(2).max(200),
        kind: z.enum(['evidence', 'progress']).default('evidence'),
        // Evidence shares require an account pin; progress shares may omit
        // email for link-only handoff to homeowners and counsel.
        recipientEmail: z.string().email().optional(),
        expiresInDays: z.number().int().min(0).max(365).default(30),
      })
      .parse(req.body);
    const { supabase, orgId, userId } = await requireOrgContext(req);

    if (body.kind === 'evidence' && !body.recipientEmail) {
      throw new HttpError(400, 'Evidence shares require a recipient email.', 'recipient_required');
    }

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

    const recipientEmail = body.recipientEmail?.toLowerCase() ?? null;

    const { data: share, error } = await supabase
      .from('verifier_shares')
      .insert({
        org_id: orgId,
        job_id: body.jobId,
        label: body.label,
        recipient_email: recipientEmail,
        share_kind: body.kind,
        created_by: userId,
        expires_at: expiresAt,
      })
      .select('id, access_token, label, expires_at, created_at')
      .single();
    if (error) throw new HttpError(400, error.message, 'share_failed');

    const sharePath =
      body.kind === 'progress'
        ? `/progress/${(share as any).access_token}`
        : `/verifier/shared/${(share as any).access_token}`;
    const admin = createAdminClient();

    // Whether the pinned address already answers to an Atmosphere account
    // decides which instructions the email gives — and it is handed back so
    // the screen can say it too, because "will this open for them" is the
    // question the sharer is standing there with.
    let recipientHasAccount = false;
    if (admin && recipientEmail) {
      const { data: existing } = await admin
        .from('profiles')
        .select('id')
        .ilike('email', recipientEmail)
        .limit(1)
        .maybeSingle();
      recipientHasAccount = Boolean(existing);
    }

    // Erasure tombstones outrank a share notification exactly as they outrank
    // an invitation: an address that asked to be forgotten gets no email from
    // this platform. The share itself stands — the link can be handed over
    // any other way — and the reason stays generic, because "this address is
    // on an erasure list" is itself a disclosure.
    let erased = false;
    if (admin && recipientEmail) {
      const { data } = await admin
        .from('network_erasures')
        .select('email')
        .eq('email', recipientEmail)
        .maybeSingle();
      erased = Boolean(data);
    }

    let emailed = false;
    if (!erased && recipientEmail) {
      try {
        const sender = await buildMailSender(orgId);
        if (sender) {
          const [{ data: org }, sharerName] = await Promise.all([
            supabase.from('orgs').select('name').eq('id', orgId).maybeSingle(),
            actorLabelFor(supabase, userId),
          ]);
          const mail =
            body.kind === 'progress'
              ? progressShareEmail({
                  orgName: (org as any)?.name ?? 'An Atmosphere member',
                  sharerName,
                  jobTitle: (job as any)?.title ?? null,
                  recipientEmail,
                  origin: publicAppOrigin(),
                  path: sharePath,
                  expiresAt,
                })
              : shareEmail({
                  orgName: (org as any)?.name ?? 'An Atmosphere member',
                  sharerName,
                  jobTitle: (job as any)?.title ?? null,
                  recipientEmail,
                  recipientHasAccount,
                  origin: publicAppOrigin(),
                  path: sharePath,
                  expiresAt,
                });
          const result = await sender.send({
            to: recipientEmail,
            subject: mail.subject,
            text: mail.text,
          });
          emailed = result.ok;
        }
      } catch {
        // The share stands; only the delivery failed, and the response's
        // emailed:false is the honest report of that.
      }
    }

    // Sharing evidence is an act on the evidence, and it goes on the record
    // under the sharer's name — including whether the recipient was told,
    // because "did they even know it existed" is a deposition question.
    await recordAccess(supabase, {
      orgId,
      jobId: body.jobId,
      action: 'shared',
      actorId: userId,
      actorLabel: await actorLabelFor(supabase, userId),
      actorRole: 'general_contractor',
      detail: `${body.kind === 'progress' ? 'Progress' : 'Verifier'} link issued to ${body.label}${
        recipientEmail ? ` <${recipientEmail}>` : ''
      }${
        expiresAt ? `, expires ${expiresAt.slice(0, 10)}` : ', no expiry'
      }${emailed ? ', emailed' : ', email not sent'}`,
    });

    res.status(201).json({
      share: {
        id: (share as any).id,
        label: (share as any).label,
        kind: body.kind,
        expiresAt: (share as any).expires_at,
        createdAt: (share as any).created_at,
        path: sharePath,
      },
      emailed,
      recipientHasAccount: body.kind === 'evidence' ? recipientHasAccount : false,
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/evidence-portal/shares?jobId= — the outstanding links. */
evidencePortalRouter.get('/shares', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId, kind } = z
      .object({
        jobId: z.string().uuid().optional(),
        kind: z.enum(['evidence', 'progress']).optional(),
      })
      .parse(req.query);
    const { supabase, orgId } = await requireOrgContext(req);
    let query = supabase
      .from('verifier_shares')
      .select(
        'id, job_id, label, recipient_email, access_token, share_kind, created_at, expires_at, revoked_at, last_opened_at, open_count',
      )
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (jobId) query = query.eq('job_id', jobId);
    if (kind) query = query.eq('share_kind', kind);
    const { data, error } = await query;
    if (error) throw new HttpError(500, error.message, 'shares_failed');

    res.json({
      shares: (data ?? []).map((row: any) => ({
        id: row.id,
        jobId: row.job_id,
        label: row.label,
        kind: row.share_kind ?? 'evidence',
        recipientEmail: row.recipient_email ?? null,
        path:
          row.share_kind === 'progress'
            ? `/progress/${row.access_token}`
            : `/verifier/shared/${row.access_token}`,
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
async function shareForToken(token: string, req: Request) {
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
  // Revoked and expired are told apart on purpose: they prompt different
  // phone calls from the person holding the dead link.
  if (state === 'missing') throw new HttpError(404, 'This link does not exist.', 'not_found');
  if (state === 'revoked') throw new HttpError(410, 'This link was revoked.', 'revoked');
  if (state === 'expired') throw new HttpError(410, 'This link has expired.', 'expired');
  if ((share as any)?.share_kind === 'progress') {
    throw new HttpError(404, 'This link does not exist.', 'not_found');
  }

  const sessionEmail = req.user?.email ?? null;
  if (!shareRecipientAllowed((share as any).recipient_email, sessionEmail)) {
    throw new HttpError(
      403,
      `This evidence was shared with ${(share as any).recipient_email}. You are signed in as ${sessionEmail ?? 'nobody'} — sign in with the account the share was issued to.`,
      'wrong_account',
    );
  }

  // The custody log records the verified account, with the share's label as
  // context. A named, signed-in identity survives a deposition; "someone
  // with the link" does not.
  const viewer = {
    userId: req.user!.id,
    email: sessionEmail as string,
    custodyLabel: `${(share as any).label} — signed in as ${sessionEmail}`,
  };

  return { share: share as any, admin, viewer };
}

/** GET /api/verifier-share/:token — the job's evidence, for the link holder. */
evidenceShareRouter.get('/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { share, admin } = await shareForToken(req.params.token, req);

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
      const { share, admin, viewer } = await shareForToken(req.params.token, req);

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
        actorLabel: viewer.custodyLabel,
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
      const { share, admin, viewer } = await shareForToken(req.params.token, req);

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
        actorLabel: viewer.custodyLabel,
        actorRole: 'external_reviewer',
        detail: `via Verifier link — original video, ${(proof as any).phase} · ${(proof as any).work_date}`,
      });

      res.json({ url: (data as any).signedUrl, expiresInSeconds: 600 });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/verifier-share/:token/evidence/:proofId/download
 *
 * Watching was free; keeping a copy is the paid act. The decision is the
 * library's one rule; this route only fetches the org's fee, finds or opens
 * the ledger row, and refuses to mint until the row is settled. 402 is the
 * honest status code and it carries everything the client needs to proceed.
 */
evidenceShareRouter.post(
  '/:token/evidence/:proofId/download',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { share, admin, viewer } = await shareForToken(req.params.token, req);

      const { data: proof } = await admin
        .from('job_proofs')
        .select('id, job_id, storage_path, phase, work_date')
        .eq('job_id', share.job_id)
        .eq('id', req.params.proofId)
        .maybeSingle();
      if (!proof) throw new HttpError(404, 'No such clip on this job.', 'not_found');

      const { data: policy } = await admin
        .from('evidence_download_policy')
        .select('download_fee_cents')
        .eq('org_id', share.org_id)
        .maybeSingle();
      const feeCents = (policy as any)?.download_fee_cents ?? 2500;

      const { data: ledger } = await admin
        .from('evidence_downloads')
        .select('id, status')
        .eq('proof_id', (proof as any).id)
        .eq('requested_by', viewer.userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const decision = downloadDecision({
        isOrgMember: false,
        feeCents,
        ledgerStatus: ((ledger as any)?.status as any) ?? null,
      });

      if (decision.action === 'require_payment') {
        // One pending row per requester per clip; asking twice is not two debts.
        let downloadId = (ledger as any)?.status === 'pending_payment' ? (ledger as any).id : null;
        if (!downloadId) {
          const { data: created, error } = await admin
            .from('evidence_downloads')
            .insert({
              org_id: share.org_id,
              proof_id: (proof as any).id,
              share_id: share.id,
              requested_by: viewer.userId,
              requester_email: viewer.email,
              fee_cents: feeCents,
              status: 'pending_payment',
            })
            .select('id')
            .single();
          if (error) throw new HttpError(500, error.message, 'ledger_failed');
          downloadId = (created as any).id;
        }
        res.status(402).json({
          feeCents,
          downloadId,
          message: `Downloading the original file costs $${(feeCents / 100).toFixed(2)}. Viewing remains free.`,
        });
        return;
      }

      // Settled (or the org charges nothing): mint, ledger the free case, log.
      if (decision.reason === 'no_fee' && !(ledger as any)) {
        await admin.from('evidence_downloads').insert({
          org_id: share.org_id,
          proof_id: (proof as any).id,
          share_id: share.id,
          requested_by: viewer.userId,
          requester_email: viewer.email,
          fee_cents: 0,
          status: 'waived',
          paid_via: 'no_fee',
          paid_at: new Date().toISOString(),
        });
      }

      const { data, error } = await admin.storage
        .from(PROOF_BUCKET)
        .createSignedUrl((proof as any).storage_path, 600, { download: true });
      if (error) throw new HttpError(500, error.message, 'signed_url_failed');

      await recordAccess(admin, {
        orgId: share.org_id,
        jobId: share.job_id,
        proofId: (proof as any).id,
        action: 'downloaded',
        actorLabel: viewer.custodyLabel,
        actorRole: 'external_reviewer',
        detail: `original file · ${(proof as any).phase} · ${(proof as any).work_date} · ${decision.reason === 'paid' ? `fee $${(feeCents / 100).toFixed(2)} paid` : decision.reason}`,
      });

      res.json({ url: (data as any).signedUrl, expiresInSeconds: 600 });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/verifier-share/:token/downloads/:downloadId/pay
 *
 * Settlement. In production this endpoint refuses — a real charge settles
 * through Stripe checkout landing on the webhooks router, the same path the
 * billing credits already use — and the refusal names that, so nobody ships
 * a build where "pay" is a button that pretends. Outside production it
 * settles as 'dev' so the whole flow is exercisable end to end.
 */
evidenceShareRouter.post(
  '/:token/downloads/:downloadId/pay',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { share, admin, viewer } = await shareForToken(req.params.token, req);

      if (config.isProduction) {
        throw new HttpError(
          501,
          'Card payment for downloads is not wired on this server yet. The charge will settle through Stripe checkout; until then, ask the sharing organization to waive the fee.',
          'payment_not_wired',
        );
      }

      const { data: ledger } = await admin
        .from('evidence_downloads')
        .select('id, status, requested_by, org_id')
        .eq('id', req.params.downloadId)
        .maybeSingle();
      if (!ledger || (ledger as any).org_id !== share.org_id) {
        throw new HttpError(404, 'No such download request.', 'not_found');
      }
      if ((ledger as any).requested_by !== viewer.userId) {
        throw new HttpError(403, 'This download request belongs to another account.', 'not_yours');
      }
      if ((ledger as any).status !== 'pending_payment') {
        res.json({ ok: true, alreadySettled: true });
        return;
      }

      const { error } = await admin
        .from('evidence_downloads')
        .update({ status: 'paid', paid_via: 'dev', paid_at: new Date().toISOString() })
        .eq('id', (ledger as any).id);
      if (error) throw new HttpError(400, error.message, 'settle_failed');

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

