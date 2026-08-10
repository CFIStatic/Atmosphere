import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { createAdminClient } from '../lib/supabase.js';
import { badRequest, HttpError, serviceUnavailable } from '../lib/errors.js';
import { createUploadUrl, recordProof } from './proofOfWork.js';
import {
  FIELD_JOB_EXCLUDED_STATUSES,
  buildFieldJobSearchOr,
  mapFieldJobRow,
  sanitizeFieldSearchQuery,
  type FieldJobRow,
} from './fieldAppJobs.js';

/**
 * Field Capture (App Store) ↔ platform account bridge.
 *
 * Same Supabase user / org membership as the dashboard. The phone signs in
 * with email+password, then uploads day films into `job_proofs` so the office
 * evidence library and job record see them — not a parallel catalog-only path.
 *
 * Workers can film any open job in the org (assigned or not). Search finds a
 * job by address / number / title when something comes up off-schedule; the
 * first upload creates a durable Field Capture party on that job.
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

async function loadAddressMap(
  supabase: Awaited<ReturnType<typeof requireOrgContext>>['supabase'],
  propertyIds: string[],
) {
  const addressById = new Map<string, string>();
  if (!propertyIds.length) return addressById;
  const { data: props } = await supabase
    .from('crm_properties')
    .select('id, address_line1, city')
    .in('id', propertyIds);
  for (const p of (props ?? []) as any[]) {
    const line = [p.address_line1, p.city].filter(Boolean).join(', ');
    if (line) addressById.set(p.id, line);
  }
  return addressById;
}

async function findPropertyIdsByQuery(
  supabase: Awaited<ReturnType<typeof requireOrgContext>>['supabase'],
  orgId: string,
  safe: string,
): Promise<string[]> {
  if (!safe) return [];
  const { data: props } = await supabase
    .from('crm_properties')
    .select('id')
    .eq('org_id', orgId)
    .or(
      `address_line1.ilike.%${safe}%,city.ilike.%${safe}%,label.ilike.%${safe}%,postal_code.ilike.%${safe}%`,
    )
    .limit(40);
  return ((props ?? []) as { id: string }[]).map((p) => p.id);
}

async function listOpenFieldJobs(
  supabase: Awaited<ReturnType<typeof requireOrgContext>>['supabase'],
  orgId: string,
  opts: { orFilter?: string | null; limit: number },
) {
  let query = supabase
    .from('crm_jobs')
    .select('id, job_number, title, status, scheduled_start, property_id')
    .eq('org_id', orgId)
    .not('status', 'in', FIELD_JOB_EXCLUDED_STATUSES)
    .order('scheduled_start', { ascending: true, nullsFirst: false })
    .limit(opts.limit);

  if (opts.orFilter) {
    query = query.or(opts.orFilter);
  }

  const { data: jobs, error } = await query;
  if (error) throw new HttpError(500, error.message, 'field_jobs_failed');

  const rows = (jobs ?? []) as FieldJobRow[];
  const propertyIds = [...new Set(rows.map((j) => j.property_id).filter(Boolean))] as string[];
  const addressById = await loadAddressMap(supabase, propertyIds);
  return rows.map((j) => mapFieldJobRow(j, addressById));
}

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
    const { data: org } = await supabase.from('orgs').select('id, name').eq('id', orgId).maybeSingle();
    const jobs = await listOpenFieldJobs(supabase, orgId, { limit: 50 });
    res.json({
      jobs,
      org: {
        id: orgId,
        name: (org as { name?: string } | null)?.name ?? 'Organization',
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/field-app/jobs/search?q=&limit=
 *
 * Search open jobs in **this company only** (`org_id` from the session — never
 * cross-tenant). Match by address, job #, title, claim #, or id so a crew can
 * file spur-of-the-moment footage on a job they were not personally invited to.
 * Empty `q` returns the same list as /today.
 */
fieldAppRouter.get('/jobs/search', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const { data: org } = await supabase.from('orgs').select('id, name').eq('id', orgId).maybeSingle();
    const orgOut = {
      id: orgId,
      name: (org as { name?: string } | null)?.name ?? 'Organization',
    };
    const raw = typeof req.query.q === 'string' ? req.query.q : '';
    const safe = sanitizeFieldSearchQuery(raw);
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(Math.trunc(limitRaw), 1), 50)
      : 30;

    if (!safe) {
      const jobs = await listOpenFieldJobs(supabase, orgId, { limit });
      res.json({ jobs, q: '', org: orgOut });
      return;
    }

    const propertyIds = await findPropertyIdsByQuery(supabase, orgId, safe);
    const orFilter = buildFieldJobSearchOr(safe, propertyIds);
    const jobs = await listOpenFieldJobs(supabase, orgId, { orFilter, limit });
    res.json({ jobs, q: safe, org: orgOut });
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

/**
 * POST /api/field-app/jobs/:jobId/capture-link
 * Open (or reuse) the Field Capture party and return a web capture URL so the
 * dashboard / phone browser can film a job the worker was not invited to.
 */
fieldAppRouter.post(
  '/jobs/:jobId/capture-link',
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
      const token = party.access_token;
      res.json({
        jobId: req.params.jobId,
        partyId: party.id,
        token,
        fieldCapturePath: `/fieldcapture/index.html?token=${encodeURIComponent(token)}`,
      });
    } catch (err) {
      next(err);
    }
  },
);

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
