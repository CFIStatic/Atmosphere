import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { createAdminClient } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import {
  assessJob,
  clearToWork,
  scopeForParty,
  scopeMoney,
  type Party,
  type ScopeItem,
} from '../shared/jobRecord.js';
import { buildCaptureGuide } from '../shared/captureGuide.js';
import {
  createUploadUrl,
  recordProof,
  listPartyProofs,
  jobProofs,
  decideProofDay,
  askAboutProofs,
  proofQuestions,
  proofVideoUrl,
  reanalyseProofDay,
  liveObserve,
  jobEvidence,
  evidenceCustody,
  setEvidenceHold,
} from './proofOfWork.js';

/**
 * The shared job record.
 *
 * Two routers in one file because they are two views of exactly the same rows,
 * and the moment they stop being the same rows the whole thing is worthless.
 * The general contractor sees it through their session; the subcontractor sees
 * it through a per-job token, because a sub works for six GCs and will not keep
 * an account with any of them.
 *
 * The token side is deliberately narrow. It never touches PostgREST — a token
 * that granted direct table access would be a bearer credential for a whole
 * org's rows, sitting in somebody's email. It is exchanged here for a
 * server-side read of one job, and the only things it can write are the two
 * things a sub genuinely does: accept the scope, and ask a question.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const sharedJobsRouter = Router();
sharedJobsRouter.use(requireAuth);

/** The external side. No session — the token is the whole credential. */
export const jobShareRouter = Router();

const shareLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests.', code: 'rate_limited' },
});

const PARTY_SELECT =
  'id, company, trade, contact_name, email, phone, role, invited_at, last_seen_at, revoked_at, created_at';
const SCOPE_SELECT =
  'id, party_id, state, title, detail, amount, reason, revision, decided_at, created_at';

/** Everything about one job's shared record, loaded once. */
async function loadRecord(supabase: any, orgId: string, jobId: string) {
  const [job, parties, scope, briefs, acks, messages] = await Promise.all([
    supabase
      .from('crm_jobs')
      .select('id, job_number, title, status, claim_number, scheduled_start, scheduled_end')
      .eq('org_id', orgId)
      .eq('id', jobId)
      .maybeSingle(),
    supabase.from('job_parties').select(PARTY_SELECT).eq('job_id', jobId).order('created_at'),
    supabase.from('job_scope_items').select(SCOPE_SELECT).eq('job_id', jobId).order('created_at'),
    supabase
      .from('job_briefs')
      .select('id, revision, facts, note, created_at')
      .eq('job_id', jobId)
      .order('revision', { ascending: false }),
    supabase
      .from('job_acknowledgements')
      .select('party_id, revision, acknowledged_name, acknowledged_at')
      .eq('job_id', jobId),
    supabase
      .from('job_messages')
      .select('id, party_id, author_label, body, scope_item_id, is_decision, created_at')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false })
      .limit(200),
  ]);

  return {
    job: job.data,
    parties: ((parties.data ?? []) as any[]) as Party[],
    scope: ((scope.data ?? []) as any[]) as ScopeItem[],
    briefs: (briefs.data ?? []) as any[],
    acks: (acks.data ?? []) as any[],
    messages: (messages.data ?? []) as any[],
  };
}

/**
 * GET /api/operations/shared
 * Every job in the org — including brand-new intake jobs that just got
 * Field Capture invites. Party readiness (behind / awaiting) is overlaid
 * from job_share_status when present; a job with no parties still lists.
 *
 * Unresolved work floats first; newest jobs break ties so a job you just
 * created is easy to find.
 */
sharedJobsRouter.get('/shared', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);

    const { data: jobs, error: jobsError } = await supabase
      .from('crm_jobs')
      .select('id, job_number, title, status, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (jobsError) throw new HttpError(500, jobsError.message, 'shared_failed');

    const jobRows = (jobs ?? []) as any[];
    if (!jobRows.length) {
      res.json({ jobs: [], counts: { jobs: 0, parties: 0, blockers: 0, awaiting: 0 } });
      return;
    }

    const jobIds = jobRows.map((j) => j.id as string);
    const { data: statusRows, error: statusError } = await supabase
      .from('job_share_status')
      .select('*')
      .eq('org_id', orgId)
      .in('job_id', jobIds);
    // A missing/broken readiness view must not hide jobs the office just created.
    if (statusError) {
      console.warn('[shared] job_share_status unavailable:', statusError.message);
    }

    const rows = (statusRows ?? []) as any[];
    const byJob = new Map<string, any[]>();
    for (const row of rows) {
      const list = byJob.get(row.job_id) ?? [];
      list.push(row);
      byJob.set(row.job_id, list);
    }

    const out = jobRows.map((job) => {
      const partyRows = byJob.get(job.id) ?? [];
      const awaiting = partyRows.length
        ? Math.max(...partyRows.map((r) => Number(r.awaiting_answer ?? 0)), 0)
        : 0;
      const behind = partyRows.filter((r) => !r.revoked_at && !r.up_to_date).length;
      return {
        jobId: job.id as string,
        jobNumber: job.job_number ?? null,
        title: (job.title as string) ?? 'Job',
        status: (job.status as string) ?? null,
        parties: partyRows.filter((r) => !r.revoked_at).length,
        currentRevision: partyRows[0]?.current_revision ?? null,
        behind,
        awaiting,
        exclusions: Number(partyRows[0]?.exclusions ?? 0),
        createdAt: (job.created_at as string) ?? null,
      };
    });

    // Needs attention first; then newest created (intake handoff).
    out.sort((a, b) => {
      const urgency = b.behind + b.awaiting - (a.behind + a.awaiting);
      if (urgency) return urgency;
      return String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''));
    });

    res.json({
      jobs: out.map(({ createdAt: _createdAt, ...job }) => job),
      counts: {
        jobs: out.length,
        parties: rows.filter((r) => !r.revoked_at).length,
        blockers: out.reduce((n, j) => n + j.behind, 0),
        awaiting: out.reduce((n, j) => n + j.awaiting, 0),
      },
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/operations/shared/:jobId — the record itself. */
sharedJobsRouter.get('/shared/:jobId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const record = await loadRecord(supabase, orgId, req.params.jobId);
    if (!record.job) throw new HttpError(404, 'No such job.', 'job_not_found');

    const currentRevision = record.briefs[0]?.revision ?? null;
    const ackByParty = new Map<string, number>();
    for (const ack of record.acks) {
      const best = ackByParty.get(ack.party_id) ?? 0;
      if (ack.revision > best) ackByParty.set(ack.party_id, ack.revision);
    }

    res.json({
      job: {
        id: record.job.id,
        jobNumber: record.job.job_number,
        title: record.job.title,
        status: record.job.status,
        claimNumber: record.job.claim_number,
      },
      brief: record.briefs[0] ?? null,
      // Every revision, so "what did it say when they accepted it" is
      // answerable rather than argued about.
      revisions: record.briefs.map((b) => ({
        revision: b.revision,
        note: b.note,
        createdAt: b.created_at,
      })),
      currentRevision,
      parties: record.parties.map((party) => {
        const acked = ackByParty.get(party.id) ?? null;
        return {
          ...party,
          acknowledgedRevision: acked,
          ...clearToWork({
            party,
            scope: record.scope,
            acknowledgedRevision: acked,
            currentRevision,
          }),
        };
      }),
      scope: record.scope,
      money: scopeMoney(record.scope),
      messages: record.messages,
      risks: assessJob({
        parties: record.parties,
        scope: record.scope,
        acknowledgements: record.acks,
        currentRevision,
      }),
    });
  } catch (err) {
    next(err);
  }
});

const partySchema = z.object({
  company: z.string().trim().min(1).max(160),
  trade: z.string().trim().max(60).nullable().optional(),
  contactName: z.string().trim().max(160).nullable().optional(),
  email: z.string().email().max(200).nullable().optional(),
  phone: z.string().trim().max(60).nullable().optional(),
  role: z.enum(['general_contractor', 'subcontractor', 'owner', 'adjuster']).optional(),
});

sharedJobsRouter.post(
  '/shared/:jobId/parties',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, userId, supabase } = await requireOrgContext(req);
      const input = partySchema.parse(req.body ?? {});

      const { data, error } = await supabase
        .from('job_parties')
        .insert({
          org_id: orgId,
          job_id: req.params.jobId,
          company: input.company,
          trade: input.trade ?? null,
          contact_name: input.contactName ?? null,
          email: input.email ?? null,
          phone: input.phone ?? null,
          role: input.role ?? 'subcontractor',
          created_by: userId,
        })
        .select(`${PARTY_SELECT}, access_token`)
        .single();
      if (error) throw new HttpError(400, error.message, 'party_create_failed');
      res.status(201).json({ party: data });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /shared/:jobId/parties/:partyId/link
 * The link for this company, so it can be sent again.
 *
 * A token shown once at creation is a token nobody can resend when the sub
 * changes phones or the text never arrived, and the workaround people reach for
 * is adding the company a second time — which quietly splits their acceptance
 * and their proof history across two rows.
 *
 * Only somebody already inside the org can read it, and they can already revoke
 * it, so this grants nothing they did not have.
 */
sharedJobsRouter.get(
  '/shared/:jobId/parties/:partyId/link',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, supabase } = await requireOrgContext(req);
      const { data, error } = await supabase
        .from('job_parties')
        .select('company, access_token, revoked_at')
        .eq('org_id', orgId)
        .eq('job_id', req.params.jobId)
        .eq('id', req.params.partyId)
        .maybeSingle();
      if (error) throw new HttpError(500, error.message, 'link_failed');
      if (!data) throw new HttpError(404, 'No such company on this job.', 'party_not_found');
      if ((data as any).revoked_at) {
        throw new HttpError(409, 'Access for this company was revoked.', 'revoked');
      }

      res.json({
        company: (data as any).company,
        path: `/shared/${(data as any).access_token}`,
      });
    } catch (err) {
      next(err);
    }
  },
);

/** Revoke rather than delete: who had access when is part of the record. */
sharedJobsRouter.post(
  '/shared/:jobId/parties/:partyId/revoke',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, supabase } = await requireOrgContext(req);
      const { error } = await supabase
        .from('job_parties')
        .update({ revoked_at: new Date().toISOString() })
        .eq('org_id', orgId)
        .eq('id', req.params.partyId);
      if (error) throw new HttpError(400, error.message, 'revoke_failed');
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

const briefSchema = z.object({
  facts: z.record(z.string().max(80), z.string().max(2000)).optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});

/**
 * POST /api/operations/shared/:jobId/brief
 * Publish a new revision.
 *
 * Publishing is the act that lapses everybody's acceptance, which is the point:
 * the facts changed, so "they accepted it" stops being true about what is
 * current. The response says how many people that just affected, because
 * quietly invalidating four subs' acceptance is a thing somebody should be told
 * they are doing.
 */
sharedJobsRouter.post(
  '/shared/:jobId/brief',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, userId, supabase } = await requireOrgContext(req);
      const input = briefSchema.parse(req.body ?? {});

      const { data, error } = await supabase
        .from('job_briefs')
        .insert({
          org_id: orgId,
          job_id: req.params.jobId,
          facts: input.facts ?? {},
          note: input.note ?? null,
          created_by: userId,
        })
        .select('id, revision, facts, note, created_at')
        .single();
      if (error) throw new HttpError(400, error.message, 'brief_failed');

      const { data: parties } = await supabase
        .from('job_parties')
        .select('id')
        .eq('job_id', req.params.jobId)
        .is('revoked_at', null);

      res.status(201).json({
        brief: data,
        // Not a side note. Everybody listed here is now working from something
        // that has been superseded until they accept again.
        acceptanceLapsedFor: (parties ?? []).length,
      });
    } catch (err) {
      next(err);
    }
  },
);

const scopeSchema = z.object({
  title: z.string().trim().min(2).max(200),
  detail: z.string().trim().max(4000).nullable().optional(),
  state: z.enum(['included', 'excluded', 'proposed']).optional(),
  amount: z.number().min(0).nullable().optional(),
  reason: z.string().trim().max(1000).nullable().optional(),
  partyId: z.string().uuid().nullable().optional(),
});

sharedJobsRouter.post(
  '/shared/:jobId/scope',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, userId, supabase } = await requireOrgContext(req);
      const input = scopeSchema.parse(req.body ?? {});

      const { data: brief } = await supabase
        .from('job_briefs')
        .select('revision')
        .eq('job_id', req.params.jobId)
        .order('revision', { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data, error } = await supabase
        .from('job_scope_items')
        .insert({
          org_id: orgId,
          job_id: req.params.jobId,
          party_id: input.partyId ?? null,
          state: input.state ?? 'included',
          title: input.title,
          detail: input.detail ?? null,
          amount: input.amount ?? null,
          reason: input.reason ?? null,
          revision: (brief as any)?.revision ?? 1,
          created_by: userId,
        })
        .select(SCOPE_SELECT)
        .single();
      if (error) throw new HttpError(400, error.message, 'scope_failed');
      res.status(201).json({ item: data });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/operations/shared/:jobId/scope/:itemId/decide
 * Answer a request — approve with a number, or decline with a reason.
 */
sharedJobsRouter.post(
  '/shared/:jobId/scope/:itemId/decide',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, userId, supabase } = await requireOrgContext(req);
      const input = z
        .object({
          decision: z.enum(['approved', 'declined']),
          amount: z.number().min(0).nullable().optional(),
          reason: z.string().trim().max(1000).nullable().optional(),
        })
        .parse(req.body ?? {});

      // The constraint enforces this too; catching it here gives a sentence
      // instead of a constraint violation.
      if (input.decision === 'approved' && (input.amount === null || input.amount === undefined)) {
        throw new HttpError(
          400,
          'Approve with an amount. Agreeing the price afterwards is a negotiation.',
          'amount_required',
        );
      }

      const { data, error } = await supabase
        .from('job_scope_items')
        .update({
          state: input.decision,
          amount: input.amount ?? null,
          reason: input.reason ?? null,
          decided_by: userId,
          decided_at: new Date().toISOString(),
        })
        .eq('org_id', orgId)
        .eq('id', req.params.itemId)
        .select(SCOPE_SELECT)
        .single();
      if (error) throw new HttpError(400, error.message, 'decide_failed');
      res.json({ item: data });
    } catch (err) {
      next(err);
    }
  },
);

sharedJobsRouter.post(
  '/shared/:jobId/messages',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, userId, supabase } = await requireOrgContext(req);
      const input = z
        .object({
          body: z.string().trim().min(1).max(4000),
          scopeItemId: z.string().uuid().nullable().optional(),
          isDecision: z.boolean().optional(),
        })
        .parse(req.body ?? {});

      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, email')
        .eq('id', userId)
        .maybeSingle();

      const { data, error } = await supabase
        .from('job_messages')
        .insert({
          org_id: orgId,
          job_id: req.params.jobId,
          author_id: userId,
          author_label: (profile as any)?.full_name ?? (profile as any)?.email ?? 'Office',
          body: input.body,
          scope_item_id: input.scopeItemId ?? null,
          is_decision: input.isDecision ?? false,
        })
        .select('id, party_id, author_label, body, scope_item_id, is_decision, created_at')
        .single();
      if (error) throw new HttpError(400, error.message, 'message_failed');
      res.status(201).json({ message: data });
    } catch (err) {
      next(err);
    }
  },
);

/* ---- The subcontractor's side ------------------------------------------- */

/**
 * Resolve a token to a party, and stamp that they looked.
 *
 * Uses the admin client because the caller has no session by construction —
 * which is exactly why every query below is pinned to the one job the token
 * belongs to, and why the token never leaves this function.
 */
async function partyForToken(token: string) {
  const admin = createAdminClient();
  if (!admin) throw new HttpError(503, 'Shared access is not configured.', 'no_admin');

  const { data } = await admin
    .from('job_parties')
    .select('id, org_id, job_id, company, trade, contact_name, role, invited_at, last_seen_at, revoked_at')
    .eq('access_token', token)
    .maybeSingle();

  if (!data) throw new HttpError(404, 'This link is not valid.', 'bad_token');
  if ((data as any).revoked_at) {
    throw new HttpError(403, 'Access to this job was withdrawn.', 'revoked');
  }

  // Recorded rather than incidental: "they never opened it" is a fact the
  // general contractor needs, and it is only knowable if this is written down.
  await admin
    .from('job_parties')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', (data as any).id);

  return { party: data as any, admin };
}

/**
 * GET /api/job-share/:token/capture-guide?phase=before|after
 *
 * The shot list for today's video, built from this party's own scope. Served
 * on the token so the crew reads it on the same screen they film from.
 */
jobShareRouter.get(
  '/:token/capture-guide',
  shareLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const phase = req.query.phase === 'after' ? 'after' : 'before';
      const { party, admin } = await partyForToken(req.params.token);

      const { data: scope } = await admin
        .from('job_scope_items')
        .select('title, state, reason, party_id, created_at')
        .eq('job_id', party.job_id)
        .order('created_at');

      const mine = scopeForParty((scope ?? []) as any[], party.id);
      res.json({
        guide: buildCaptureGuide({
          phase,
          scope: mine.map((s: any) => ({ title: s.title, state: s.state, reason: s.reason })),
        }),
      });
    } catch (err) {
      next(err);
    }
  },
);

/** GET /api/job-share/:token — the sub's view of the job. */
jobShareRouter.get('/:token', shareLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { party, admin } = await partyForToken(req.params.token);
    const record = await loadRecord(admin, party.org_id, party.job_id);
    if (!record.job) throw new HttpError(404, 'This job no longer exists.', 'job_not_found');

    const currentRevision = record.briefs[0]?.revision ?? null;
    const mine = record.acks
      .filter((a) => a.party_id === party.id)
      .reduce((best: number | null, a) => (best === null || a.revision > best ? a.revision : best), null);

    res.json({
      you: { company: party.company, trade: party.trade, role: party.role },
      job: {
        jobNumber: record.job.job_number,
        title: record.job.title,
        claimNumber: record.job.claim_number,
        scheduledStart: record.job.scheduled_start,
      },
      brief: record.briefs[0] ?? null,
      currentRevision,
      acknowledgedRevision: mine,
      ...clearToWork({
        party,
        scope: record.scope,
        acknowledgedRevision: mine,
        currentRevision,
      }),
      // Exclusions first. Whoever reads this is reading it on a phone, and the
      // top of the screen is where they stop.
      scope: scopeForParty(record.scope, party.id),
      // Only what they can see: their own lines and the shared ones. Another
      // sub's pricing is none of their business.
      messages: record.messages.filter((m) => !m.party_id || m.party_id === party.id),
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/job-share/:token/accept — accept the current revision. */
jobShareRouter.post(
  '/:token/accept',
  shareLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { party, admin } = await partyForToken(req.params.token);
      const input = z
        .object({ name: z.string().trim().min(1).max(160), revision: z.number().int().min(1) })
        .parse(req.body ?? {});

      const { data: brief } = await admin
        .from('job_briefs')
        .select('revision')
        .eq('job_id', party.job_id)
        .order('revision', { ascending: false })
        .limit(1)
        .maybeSingle();

      const current = (brief as any)?.revision ?? null;
      // Accepting a revision that is no longer current would record consent to
      // something already superseded — worse than no acceptance, because it
      // reads as agreement.
      if (current === null || input.revision !== current) {
        throw new HttpError(
          409,
          'The scope has changed since you opened this. Reload and read it again before accepting.',
          'stale_revision',
        );
      }

      const { error } = await admin.from('job_acknowledgements').insert({
        org_id: party.org_id,
        job_id: party.job_id,
        party_id: party.id,
        revision: current,
        acknowledged_name: input.name,
      });
      // The unique index makes a double-click harmless rather than an error.
      if (error && error.code !== '23505') {
        throw new HttpError(400, error.message, 'accept_failed');
      }

      res.json({ ok: true, revision: current });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/job-share/:token/ask
 * Raise something before doing it — a question, or extra work.
 *
 * This is the whole product in one endpoint. A sub who can ask in ten seconds
 * and have it on the record asks. A sub who has to phone somebody who does not
 * pick up does the work and argues about it later.
 */
jobShareRouter.post(
  '/:token/ask',
  shareLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { party, admin } = await partyForToken(req.params.token);
      const input = z
        .object({
          body: z.string().trim().min(1).max(4000),
          /** Set when this is extra work rather than a question. */
          asScopeItem: z.string().trim().min(2).max(200).optional(),
          amount: z.number().min(0).nullable().optional(),
        })
        .parse(req.body ?? {});

      let scopeItemId: string | null = null;
      if (input.asScopeItem) {
        const { data: brief } = await admin
          .from('job_briefs')
          .select('revision')
          .eq('job_id', party.job_id)
          .order('revision', { ascending: false })
          .limit(1)
          .maybeSingle();

        const { data: item } = await admin
          .from('job_scope_items')
          .insert({
            org_id: party.org_id,
            job_id: party.job_id,
            party_id: party.id,
            state: 'proposed',
            title: input.asScopeItem,
            detail: input.body,
            amount: input.amount ?? null,
            revision: (brief as any)?.revision ?? 1,
          })
          .select('id')
          .single();
        scopeItemId = (item as any)?.id ?? null;
      }

      const { data, error } = await admin
        .from('job_messages')
        .insert({
          org_id: party.org_id,
          job_id: party.job_id,
          party_id: party.id,
          author_label: `${party.contact_name ? `${party.contact_name}, ` : ''}${party.company}`,
          body: input.body,
          scope_item_id: scopeItemId,
        })
        .select('id, author_label, body, scope_item_id, created_at')
        .single();
      if (error) throw new HttpError(400, error.message, 'ask_failed');

      res.status(201).json({ message: data, scopeItemId });
    } catch (err) {
      next(err);
    }
  },
);


/* ---- Proof of work ------------------------------------------------------- */

// The general contractor's side. Reading, deciding, and asking.
/**
 * GET /api/operations/shared/:jobId/capture-guide?phase=&partyId=
 *
 * The same shot list, through the org door — this is what the Field platform
 * shows a crew before they film. Without a partyId it covers every line on
 * the job, which is right for the org's own technicians: their day is not
 * scoped to one company's slice.
 */
sharedJobsRouter.get(
  '/shared/:jobId/capture-guide',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const phase = req.query.phase === 'after' ? 'after' : 'before';
      const partyId = typeof req.query.partyId === 'string' ? req.query.partyId : null;
      const { orgId, supabase } = await requireOrgContext(req);

      const { data: scope, error } = await supabase
        .from('job_scope_items')
        .select('title, state, reason, party_id, created_at')
        .eq('org_id', orgId)
        .eq('job_id', req.params.jobId)
        .order('created_at');
      if (error) throw new HttpError(500, error.message, 'guide_failed');

      const lines = partyId
        ? scopeForParty((scope ?? []) as any[], partyId)
        : ((scope ?? []) as any[]);
      res.json({
        guide: buildCaptureGuide({
          phase,
          scope: lines.map((s: any) => ({ title: s.title, state: s.state, reason: s.reason })),
        }),
      });
    } catch (err) {
      next(err);
    }
  },
);

sharedJobsRouter.post('/shared/:jobId/live-observe', liveObserve);
sharedJobsRouter.get('/shared/:jobId/proof', jobProofs);
sharedJobsRouter.get('/shared/:jobId/proof/questions', proofQuestions);
sharedJobsRouter.post('/shared/:jobId/proof/ask', askAboutProofs);
sharedJobsRouter.post('/shared/:jobId/proof/:workDate/decide', decideProofDay);
sharedJobsRouter.post('/shared/:jobId/proof/:workDate/analyse', reanalyseProofDay);
sharedJobsRouter.get('/shared/proof/:proofId/video', proofVideoUrl);

// Evidence, in the shape a records system uses: a list, a custody log per file,
// and a hold that outranks retention.
sharedJobsRouter.get('/shared/:jobId/evidence', jobEvidence);
sharedJobsRouter.get('/shared/:jobId/evidence/:proofId/custody', evidenceCustody);
sharedJobsRouter.post('/shared/:jobId/evidence/:proofId/hold', setEvidenceHold);

/**
 * The subcontractor's side, through their job token.
 *
 * Three calls, in the order the app makes them: ask for somewhere to put the
 * file, put it there, then tell us it is there along with everything the phone
 * knows about how it was filmed.
 */
jobShareRouter.post(
  '/:token/proof/upload-url',
  shareLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { party, admin } = await partyForToken(req.params.token);
      res.json(await createUploadUrl(party, admin, req.body));
    } catch (err) {
      next(err);
    }
  },
);

jobShareRouter.post(
  '/:token/proof',
  shareLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { party, admin } = await partyForToken(req.params.token);
      res.status(201).json(await recordProof(party, admin, req.body));
    } catch (err) {
      next(err);
    }
  },
);

jobShareRouter.get(
  '/:token/proof',
  shareLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { party, admin } = await partyForToken(req.params.token);
      res.json(await listPartyProofs(party, admin));
    } catch (err) {
      next(err);
    }
  },
);
