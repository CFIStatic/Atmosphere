import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { createAdminClient } from '../lib/supabase.js';
import { badRequest, HttpError, serviceUnavailable } from '../lib/errors.js';
import { createUploadUrl, recordAccess, recordProof } from './proofOfWork.js';

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

/** Title-only job entry from the Field Capture phone when the office has not opened the file yet. */
export const fieldQuickAddSchema = z.object({
  title: z
    .string({ required_error: 'Job name is required' })
    .trim()
    .min(2, 'Job name is too short')
    .max(200, 'Job name is too long'),
  workType: z.enum(['mitigation', 'construction']).default('construction'),
});

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
      // Enum is draft/scheduled/in_progress/on_hold/completed/invoiced/paid/cancelled —
      // unknown labels make PostgREST reject the whole list.
      .not('status', 'in', '("completed","cancelled","invoiced","paid")')
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
 * POST /api/field-app/jobs/quick-add
 *
 * Field Capture "Quick Add": the crew got a call, the office has not opened a
 * job file yet, and they still need somewhere to put today's film. They type a
 * job name; we create the org job file + a Field Capture party so it shows on
 * the office Job files dashboard. Address, scope, and the rest are filled in
 * later from the office — readiness will say what is still missing.
 */
fieldAppRouter.post('/jobs/quick-add', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, userId, supabase } = await requireOrgContext(req);
    const input = fieldQuickAddSchema.parse(req.body);

    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', userId)
      .maybeSingle();
    const fullName = (profile as { full_name?: string } | null)?.full_name ?? null;

    const scheduledStart = new Date().toISOString();
    const { data: job, error: jobError } = await supabase
      .from('crm_jobs')
      .insert({
        org_id: orgId,
        title: input.title,
        work_type: input.workType,
        status: 'scheduled',
        scheduled_start: scheduledStart,
        created_by: userId,
      })
      .select('id, title, job_number, status, scheduled_start')
      .single();
    if (jobError || !job) {
      throw new HttpError(500, jobError?.message ?? 'Could not create the job.', 'job_failed');
    }

    const jobId = (job as { id: string }).id;

    const { error: intakeError } = await supabase.from('job_intake').insert({
      job_id: jobId,
      org_id: orgId,
      source: 'manual',
      source_detail: { enteredFrom: 'field_quick_add' },
      entered_by: userId,
    });
    // Job file is still usable without provenance; do not fail the capture path.
    if (intakeError) {
      console.warn('[field-app/quick-add] job_intake insert failed', intakeError.message);
    }

    // Create the party directly — we just inserted the job, so skip the extra
    // existence round-trip in ensureFieldParty (keeps Quick Add snappy on poor
    // field networks). Party is what makes Job files list the row.
    const { data: party, error: partyError } = await supabase
      .from('job_parties')
      .insert({
        org_id: orgId,
        job_id: jobId,
        company: FIELD_PARTY_COMPANY,
        trade: 'field_capture',
        contact_name: fullName ?? 'Field Capture',
        email: req.user?.email ?? null,
        role: 'general_contractor',
        created_by: userId,
      })
      .select('id, company, access_token')
      .single();
    if (partyError || !party) {
      throw new HttpError(
        400,
        partyError?.message ?? 'Could not open Field Capture on this job.',
        'party_failed',
      );
    }

    // Best-effort audit — never block the phone on the access log.
    void recordAccess(supabase, {
      orgId,
      jobId,
      action: 'job_created',
      actorId: userId,
      actorLabel: fullName ?? req.user?.email ?? 'Field Capture',
      detail: 'Quick Add from Field Capture — office can finish address and scope later',
    });

    const title = (job as { title: string }).title || input.title;
    const jobNumber = (job as { job_number?: number | null }).job_number;
    res.status(201).json({
      job: {
        id: jobId,
        number: jobNumber != null ? `#${jobNumber}` : '',
        name: title,
        address: 'Address TBD',
        at: 'Today',
        status: (job as { status?: string | null }).status ?? 'scheduled',
        placed: false,
      },
      party: { id: (party as { id: string }).id },
    });
  } catch (err) {
    if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid request'));
    else next(err);
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
