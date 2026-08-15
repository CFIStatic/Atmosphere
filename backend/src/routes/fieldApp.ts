import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { Session, User } from '@supabase/supabase-js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { createAdminClient } from '../lib/supabase.js';
import { badRequest, HttpError, serviceUnavailable } from '../lib/errors.js';
import { setSessionCookies } from '../lib/session.js';
import {
  fieldCreateJobSchema,
  fieldOfficePreviewSchema,
  fieldOfficeSchema,
  fieldRegisterSchema,
} from '../lib/validation.js';
import { createPasswordAccount, publicUser, sessionTokens } from '../auth/passwordAccount.js';
import { linkFieldOffice, previewOfficeByJoinCode } from '../field/officeLink.js';
import { authLimiter } from './auth.js';
import { createUploadUrl, recordProof } from './proofOfWork.js';
import {
  DEFAULT_FIELD_TIMEZONE,
  formatTodayAt,
  pickTodayJobs,
  todayKey,
  type TodayJobInput,
} from '../field/todayJobs.js';
import { mergeAssignedJobs, restrictToAssigned } from '../field/assignedJobs.js';

/**
 * Field Capture (App Store) ↔ platform account bridge.
 *
 * Same Supabase user / org membership as the dashboard. The phone signs in
 * with email+password, then uploads day films into `job_proofs` so the office
 * evidence library and job record see them — not a parallel catalog-only path.
 */
export const fieldAppRouter = Router();

function writeFieldSession(
  res: Response,
  status: 200 | 201,
  user: User,
  session: Session,
  extra: Record<string, unknown> = {},
) {
  setSessionCookies(res, session);
  res.status(status).json({
    user: publicUser(user),
    needsEmailConfirmation: false,
    session: sessionTokens(session),
    ...extra,
  });
}

/**
 * POST /api/field-app/register
 *
 * Native Field Capture onboarding: create the same Atmosphere account the
 * website uses, then join or start an office so day films have an org to
 * land in. Public — there is no session yet. Authenticated field-app
 * routes are mounted below.
 */
fieldAppRouter.post(
  '/register',
  authLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = fieldRegisterSchema.parse(req.body);
      const created = await createPasswordAccount(input.email, input.password);

      if (created.kind === 'error') throw created.error;

      if (created.kind === 'confirm') {
        res.status(201).json({
          user: created.user ? publicUser(created.user) : null,
          needsEmailConfirmation: true,
          message: created.message,
          org: null,
        });
        return;
      }

      try {
        const org = await linkFieldOffice(created.session.access_token, created.user, {
          fullName: input.fullName,
          joinCode: input.joinCode,
          orgName: input.orgName,
        });
        writeFieldSession(res, created.status, created.user, created.session, { org });
      } catch (err) {
        // Account exists and the phone has tokens — do not roll that back
        // because the office step failed. The app can retry linking.
        if (
          err instanceof HttpError &&
          (err.code === 'join_org_failed' || err.code === 'create_org_failed' || err.code === 'already_linked')
        ) {
          writeFieldSession(res, created.status, created.user, created.session, {
            org: null,
            orgError: err.message,
          });
          return;
        }
        throw err;
      }
    } catch (err) {
      next(err);
    }
  },
);

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

/**
 * POST /api/field-app/office
 * Link an already-signed-in Field Capture user to an office (join code or
 * new organization). Used when email confirmation delayed the office step,
 * or when register created the login but the join code was wrong.
 */
fieldAppRouter.post('/office', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user || !req.accessToken) {
      throw new HttpError(401, 'Not authenticated', 'unauthorized');
    }
    const input = fieldOfficeSchema.parse(req.body);
    const org = await linkFieldOffice(req.accessToken, req.user, input);
    res.status(201).json({ org });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/field-app/office/preview
 * Confirm a join code before the phone attaches this login to that office.
 */
fieldAppRouter.post('/office/preview', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.accessToken) {
      throw new HttpError(401, 'Not authenticated', 'unauthorized');
    }
    const { joinCode } = fieldOfficePreviewSchema.parse(req.body);
    const org = await previewOfficeByJoinCode(req.accessToken, joinCode);
    res.json({ org });
  } catch (err) {
    next(err);
  }
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

async function orgTimezone(
  supabase: Awaited<ReturnType<typeof requireOrgContext>>['supabase'],
  orgId: string,
): Promise<string> {
  const { data } = await supabase
    .from('pm_automation_settings')
    .select('timezone')
    .eq('org_id', orgId)
    .maybeSingle();
  const zone = (data as { timezone?: string } | null)?.timezone?.trim();
  return zone || DEFAULT_FIELD_TIMEZONE;
}

type JobRow = {
  id: string;
  job_number: number | null;
  title: string | null;
  status: string | null;
  scheduled_start: string | null;
  property_id: string | null;
  work_type?: string | null;
};

async function loadAssigned(
  supabase: Awaited<ReturnType<typeof requireOrgContext>>['supabase'],
  orgId: string,
  userId: string,
) {
  const [{ data: crew }, { data: owned }] = await Promise.all([
    supabase
      .from('job_assignments')
      .select('job_id, role_on_job')
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .is('released_at', null),
    supabase.from('crm_jobs').select('id').eq('org_id', orgId).eq('owner_id', userId),
  ]);
  return mergeAssignedJobs(
    ((crew ?? []) as { job_id?: string; role_on_job?: string }[]).map((row) => ({
      jobId: row.job_id ?? '',
      role: row.role_on_job,
    })),
    ((owned ?? []) as { id?: string }[]).map((row) => row.id ?? ''),
  );
}

async function addressByPropertyIds(
  supabase: Awaited<ReturnType<typeof requireOrgContext>>['supabase'],
  propertyIds: string[],
): Promise<Map<string, string>> {
  const addressById = new Map<string, string>();
  if (!propertyIds.length) return addressById;
  const { data: props } = await supabase
    .from('crm_properties')
    .select('id, address_line1, city')
    .in('id', propertyIds);
  for (const p of (props ?? []) as { id: string; address_line1?: string; city?: string }[]) {
    const line = [p.address_line1, p.city].filter(Boolean).join(', ');
    if (line) addressById.set(p.id, line);
  }
  return addressById;
}

function asFieldJob(
  job: {
    id: string;
    jobNumber: number | null;
    title: string | null;
    status: string | null;
    scheduledStart: string | null;
    propertyId: string | null;
    workType?: string | null;
    filmed?: boolean;
  },
  addressById: Map<string, string>,
  roleById: Map<string, string>,
  timeZone: string,
) {
  const filmed = Boolean(job.filmed);
  return {
    id: job.id,
    number: job.jobNumber != null ? `#${job.jobNumber}` : '',
    name: job.title || 'Job',
    address: (job.propertyId && addressById.get(job.propertyId)) || 'Address on file',
    at: formatTodayAt(job.scheduledStart, filmed, timeZone),
    status: job.status ?? null,
    placed: Boolean(job.scheduledStart) || filmed,
    filmed,
    assigned: true,
    role: roleById.get(job.id) ?? 'crew',
    workType: job.workType ?? null,
  };
}

/**
 * GET /api/field-app/today
 * The jobs assigned to this login that belong on today's screen.
 */
fieldAppRouter.get('/today', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, userId, supabase } = await requireOrgContext(req);
    const timeZone = await orgTimezone(supabase, orgId);
    const day = todayKey(new Date(), timeZone);
    const assigned = await loadAssigned(supabase, orgId, userId);

    const [{ data: jobs, error }, proofsResult] = await Promise.all([
      supabase
        .from('crm_jobs')
        .select('id, job_number, title, status, scheduled_start, property_id, work_type')
        .eq('org_id', orgId)
        .order('scheduled_start', { ascending: true, nullsFirst: false })
        .limit(200),
      supabase.from('job_proofs').select('job_id').eq('org_id', orgId).eq('work_date', day),
    ]);

    if (error) throw new HttpError(500, error.message, 'field_jobs_failed');

    const filmedIds = [
      ...new Set(
        ((proofsResult.data ?? []) as { job_id?: string }[])
          .map((p) => p.job_id)
          .filter(Boolean),
      ),
    ] as string[];

    const inputs: TodayJobInput[] = restrictToAssigned(
      ((jobs ?? []) as JobRow[]).map((j) => ({
        id: j.id,
        jobNumber: j.job_number ?? null,
        title: j.title ?? null,
        status: j.status ?? null,
        scheduledStart: j.scheduled_start ?? null,
        propertyId: j.property_id ?? null,
        workType: j.work_type ?? null,
      })),
      assigned.ids,
    );

    const picked = pickTodayJobs(inputs, filmedIds, day, timeZone);
    const addressById = await addressByPropertyIds(
      supabase,
      [...new Set(picked.map((j) => j.propertyId).filter(Boolean))] as string[],
    );

    const out = picked.map((j) =>
      asFieldJob(
        { ...j, workType: (j as TodayJobInput & { workType?: string }).workType },
        addressById,
        assigned.roleById,
        timeZone,
      ),
    );

    res.json({ jobs: out, today: day });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/field-app/jobs
 * Every open (or filmed) job assigned to this login — not just today's.
 */
fieldAppRouter.get('/jobs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, userId, supabase } = await requireOrgContext(req);
    const timeZone = await orgTimezone(supabase, orgId);
    const day = todayKey(new Date(), timeZone);
    const assigned = await loadAssigned(supabase, orgId, userId);
    if (!assigned.ids.size) {
      res.json({ jobs: [] });
      return;
    }

    const [{ data: jobs, error }, proofsResult] = await Promise.all([
      supabase
        .from('crm_jobs')
        .select('id, job_number, title, status, scheduled_start, property_id, work_type')
        .eq('org_id', orgId)
        .in('id', [...assigned.ids])
        .order('scheduled_start', { ascending: true, nullsFirst: false })
        .limit(200),
      supabase.from('job_proofs').select('job_id').eq('org_id', orgId).eq('work_date', day),
    ]);
    if (error) throw new HttpError(500, error.message, 'field_jobs_failed');

    const filmedIds = new Set(
      ((proofsResult.data ?? []) as { job_id?: string }[]).map((p) => p.job_id).filter(Boolean),
    );
    const rows = ((jobs ?? []) as JobRow[]).filter((j) => j.status !== 'cancelled' || filmedIds.has(j.id));
    const addressById = await addressByPropertyIds(
      supabase,
      [...new Set(rows.map((j) => j.property_id).filter(Boolean))] as string[],
    );

    res.json({
      jobs: rows.map((j) =>
        asFieldJob(
          {
            id: j.id,
            jobNumber: j.job_number ?? null,
            title: j.title ?? null,
            status: j.status ?? null,
            scheduledStart: j.scheduled_start ?? null,
            propertyId: j.property_id ?? null,
            workType: j.work_type ?? null,
            filmed: filmedIds.has(j.id),
          },
          addressById,
          assigned.roleById,
          timeZone,
        ),
      ),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/field-app/jobs
 * Open a job from the phone and assign it to this login so it appears on
 * My Jobs and (if scheduled today) Today.
 */
fieldAppRouter.post('/jobs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, userId, supabase } = await requireOrgContext(req);
    const input = fieldCreateJobSchema.parse(req.body);
    const timeZone = await orgTimezone(supabase, orgId);
    const scheduledStart = input.scheduledStart ?? new Date().toISOString();

    const { data: property, error: propertyError } = await supabase
      .from('crm_properties')
      .insert({
        org_id: orgId,
        address_line1: input.address,
        city: input.city ?? null,
        created_by: userId,
      })
      .select('id')
      .single();
    if (propertyError || !property) {
      throw new HttpError(400, propertyError?.message ?? 'Could not save the address.', 'property_failed');
    }

    const { data: job, error: jobError } = await supabase
      .from('crm_jobs')
      .insert({
        org_id: orgId,
        title: input.name,
        description: input.notes ?? null,
        work_type: input.workType,
        status: 'scheduled',
        property_id: (property as { id: string }).id,
        owner_id: userId,
        scheduled_start: scheduledStart,
        created_by: userId,
      })
      .select('id, job_number, title, status, scheduled_start, property_id, work_type')
      .single();
    if (jobError || !job) {
      throw new HttpError(400, jobError?.message ?? 'Could not open that job.', 'job_failed');
    }

    const { error: assignError } = await supabase.from('job_assignments').insert({
      org_id: orgId,
      job_id: (job as JobRow).id,
      user_id: userId,
      role_on_job: 'lead',
      assigned_by: userId,
    });
    if (assignError && assignError.code !== '23505') {
      throw new HttpError(400, assignError.message, 'assign_failed');
    }

    const row = job as JobRow;
    const addressById = new Map<string, string>([
      [row.property_id ?? '', [input.address, input.city].filter(Boolean).join(', ')],
    ]);
    res.status(201).json({
      job: asFieldJob(
        {
          id: row.id,
          jobNumber: row.job_number ?? null,
          title: row.title ?? null,
          status: row.status ?? null,
          scheduledStart: row.scheduled_start ?? scheduledStart,
          propertyId: row.property_id ?? null,
          workType: row.work_type ?? input.workType,
          filmed: false,
        },
        addressById,
        new Map([[row.id, 'lead']]),
        timeZone,
      ),
    });
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
