import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { createAdminClient } from '../lib/supabase.js';
import { badRequest, HttpError, serviceUnavailable } from '../lib/errors.js';
import { createUploadUrl, recordProof } from './proofOfWork.js';
import {
  completeFieldContextSession,
  heartbeatFieldContextSession,
  startFieldContextSession,
} from '../fieldContext/store.js';

/**
 * Field Capture (App Store) ↔ platform account bridge.
 *
 * Same Supabase user / org membership as the dashboard. The phone signs in
 * with email+password, then uploads day films into `job_proofs` so the office
 * evidence library and job record see them — not a parallel catalog-only path.
 */
export const fieldAppRouter = Router();

fieldAppRouter.use(requireAuth);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 180,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many Field Capture requests. Try again later.', code: 'rate_limited' },
});
fieldAppRouter.use(limiter);

const FIELD_PARTY_COMPANY = 'Field Capture';

/** GET /api/field-app/me — who is signed in and which org receives uploads. */
fieldAppRouter.get('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, role, userId, supabase } = await requireOrgContext(req);
    const { data: org } = await supabase
      .from('orgs')
      .select('id, name')
      .eq('id', orgId)
      .maybeSingle();
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', userId)
      .maybeSingle();

    res.json({
      user: {
        id: userId,
        email: req.user?.email ?? null,
        fullName: (profile as { full_name?: string } | null)?.full_name ?? null,
      },
      org: {
        id: orgId,
        name: (org as { name?: string } | null)?.name ?? 'Organization',
        role,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/field-app/today
 * Active jobs the signed-in org member can film against.
 */
fieldAppRouter.get('/today', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);

    const { data: jobs, error } = await supabase
      .from('crm_jobs')
      .select('id, job_number, title, status, scheduled_start, property_id')
      .eq('org_id', orgId)
      .not('status', 'in', '("completed","cancelled","lost","archived")')
      .order('scheduled_start', { ascending: true, nullsFirst: false })
      .limit(50);

    if (error) throw new HttpError(500, error.message, 'field_jobs_failed');

    const rows = (jobs ?? []) as any[];
    const propertyIds = [...new Set(rows.map((j) => j.property_id).filter(Boolean))];
    const addressById = new Map<string, string>();
    if (propertyIds.length) {
      const { data: props } = await supabase
        .from('crm_properties')
        .select('id, address_line1, city')
        .in('id', propertyIds);
      for (const p of (props ?? []) as any[]) {
        const line = [p.address_line1, p.city].filter(Boolean).join(', ');
        if (line) addressById.set(p.id, line);
      }
    }

    const out = rows.map((j) => ({
      id: j.id as string,
      number: j.job_number != null ? `#${j.job_number}` : '',
      name: (j.title as string) || 'Job',
      address: (j.property_id && addressById.get(j.property_id)) || 'Address on file',
      at: j.scheduled_start
        ? new Date(j.scheduled_start).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
          })
        : 'Today',
      status: j.status ?? null,
      placed: Boolean(j.scheduled_start),
    }));

    res.json({ jobs: out });
  } catch (err) {
    next(err);
  }
});

/**
 * Ensure a durable Field Capture party on the job for this org member so
 * uploads share one proof history (not a new party every day).
 */
async function ensureFieldParty(
  supabase: Awaited<ReturnType<typeof requireOrgContext>>['supabase'],
  orgId: string,
  jobId: string,
  userId: string,
  email: string | null | undefined,
  fullName: string | null | undefined,
) {
  const { data: job } = await supabase
    .from('crm_jobs')
    .select('id')
    .eq('org_id', orgId)
    .eq('id', jobId)
    .maybeSingle();
  if (!job) throw new HttpError(404, 'No such job in your organization.', 'job_not_found');

  let existingQuery = supabase
    .from('job_parties')
    .select('id, company, access_token, revoked_at, email')
    .eq('org_id', orgId)
    .eq('job_id', jobId)
    .eq('company', FIELD_PARTY_COMPANY)
    .is('revoked_at', null)
    .limit(1);

  if (email) existingQuery = existingQuery.eq('email', email);

  const { data: existingRows } = await existingQuery;
  const existing = (existingRows ?? [])[0];
  if (existing && !(existing as any).revoked_at) {
    return existing as { id: string; access_token: string; company: string };
  }

  const { data: created, error } = await supabase
    .from('job_parties')
    .insert({
      org_id: orgId,
      job_id: jobId,
      company: FIELD_PARTY_COMPANY,
      trade: 'field_capture',
      contact_name: fullName ?? 'Field Capture',
      email: email ?? null,
      role: 'general_contractor',
      created_by: userId,
    })
    .select('id, company, access_token')
    .single();
  if (error || !created) {
    throw new HttpError(400, error?.message ?? 'Could not open Field Capture on this job.', 'party_failed');
  }
  return created as { id: string; access_token: string; company: string };
}

async function adminOrThrow() {
  const admin = createAdminClient();
  if (!admin) throw serviceUnavailable('Storage admin is not configured.', 'admin_unavailable');
  return admin;
}

/** POST /api/field-app/jobs/:jobId/proof/upload-url */
fieldAppRouter.post(
  '/jobs/:jobId/proof/upload-url',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, userId, supabase } = await requireOrgContext(req);
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', userId)
        .maybeSingle();
      const party = await ensureFieldParty(
        supabase,
        orgId,
        req.params.jobId,
        userId,
        req.user?.email,
        (profile as { full_name?: string } | null)?.full_name,
      );
      const admin = await adminOrThrow();
      // recordProof/createUploadUrl expect the party row shape from partyForToken
      const partyRow = {
        id: party.id,
        org_id: orgId,
        job_id: req.params.jobId,
        company: party.company,
        access_token: party.access_token,
      };
      res.json(await createUploadUrl(partyRow, admin, req.body));
    } catch (err) {
      if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid request'));
      else next(err);
    }
  },
);

/** POST /api/field-app/jobs/:jobId/proof — file the uploaded day film into the org record. */
fieldAppRouter.post(
  '/jobs/:jobId/proof',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, userId, supabase } = await requireOrgContext(req);
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', userId)
        .maybeSingle();
      const party = await ensureFieldParty(
        supabase,
        orgId,
        req.params.jobId,
        userId,
        req.user?.email,
        (profile as { full_name?: string } | null)?.full_name,
      );
      const admin = await adminOrThrow();
      const partyRow = {
        id: party.id,
        org_id: orgId,
        job_id: req.params.jobId,
        company: party.company,
        access_token: party.access_token,
      };
      res.status(201).json(await recordProof(partyRow, admin, req.body));
    } catch (err) {
      if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid request'));
      else next(err);
    }
  },
);

/**
 * POST /api/field-app/context/sessions
 * Open a context session when the day film starts — device / permission /
 * capability / environment snapshot plus later GPS and motion samples.
 */
fieldAppRouter.post(
  '/context/sessions',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, userId, supabase } = await requireOrgContext(req);
      const body = (req.body ?? {}) as { jobId?: string };
      if (!body.jobId) throw badRequest('jobId is required');
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', userId)
        .maybeSingle();
      const party = await ensureFieldParty(
        supabase,
        orgId,
        body.jobId,
        userId,
        req.user?.email,
        (profile as { full_name?: string } | null)?.full_name,
      );
      const admin = await adminOrThrow();
      const result = await startFieldContextSession(admin, {
        orgId,
        userId,
        partyId: party.id,
        body: req.body,
      });
      res.status(201).json(result);
    } catch (err) {
      if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid request'));
      else next(err);
    }
  },
);

/** POST /api/field-app/context/sessions/:sessionId/heartbeat */
fieldAppRouter.post(
  '/context/sessions/:sessionId/heartbeat',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId } = await requireOrgContext(req);
      const admin = await adminOrThrow();
      res.json(
        await heartbeatFieldContextSession(admin, {
          orgId,
          sessionId: req.params.sessionId,
          body: req.body,
        }),
      );
    } catch (err) {
      if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid request'));
      else next(err);
    }
  },
);

/** POST /api/field-app/context/sessions/:sessionId/complete */
fieldAppRouter.post(
  '/context/sessions/:sessionId/complete',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId } = await requireOrgContext(req);
      const admin = await adminOrThrow();
      res.json(
        await completeFieldContextSession(admin, {
          orgId,
          sessionId: req.params.sessionId,
          body: req.body,
        }),
      );
    } catch (err) {
      if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid request'));
      else next(err);
    }
  },
);
