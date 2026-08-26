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
  fieldJoinSchema,
  fieldOfficePreviewSchema,
  fieldOfficeSchema,
  fieldRegisterSchema,
} from '../lib/validation.js';
import { createPasswordAccount, publicUser, sessionTokens } from '../auth/passwordAccount.js';
import { linkFieldOffice } from '../field/officeLink.js';
import { joinCrewByName, previewOfficePublic } from '../field/crewJoin.js';
import { authLimiter } from './auth.js';
import { createUploadUrl, recordProof } from './proofOfWork.js';
import {
  DEFAULT_FIELD_TIMEZONE,
  formatTodayAt,
  pickInviteToken,
  pickTodayJobs,
  todayKey,
  type TodayJobInput,
} from '../field/todayJobs.js';
import { jobSharePagePath } from '../lib/jobSharePath.js';

/**
 * Field Capture (App Store) ↔ platform account bridge.
 *
 * Crew connect is name + office join code. That creates (or reopens) a
 * field-technician membership so the dashboard can assign jobs to that name.
 * Day films land in `job_proofs` on the office record. A dashboard
 * email/password login still works for people who already have one.
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

/**
 * POST /api/field-app/join
 *
 * Crew connect: first and last name plus the office join code from Settings.
 * Public — there is no session yet. The same name + code on another phone
 * reopens this person so assignments stay on Nick Smith.
 */
fieldAppRouter.post(
  '/join',
  authLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = fieldJoinSchema.parse(req.body);
      const joined = await joinCrewByName(input);
      writeFieldSession(res, joined.created ? 201 : 200, joined.user, joined.session, {
        org: joined.org,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/field-app/office/preview
 * Confirm a join code on the connect screen (no session yet).
 */
fieldAppRouter.post(
  '/office/preview',
  authLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { joinCode } = fieldOfficePreviewSchema.parse(req.body);
      const org = await previewOfficePublic(joinCode);
      res.json({ org });
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

/**
 * GET /api/field-app/today
 * Every open job this person can add video to. If the office has put them on
 * a crew, only those jobs (plus anything they already filmed today) show.
 * Until then, the org's open jobs still appear so the first day of filming
 * is not blocked on an assignment — and a missing start date never hides a job.
 */
fieldAppRouter.get('/today', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, userId, supabase } = await requireOrgContext(req);
    const timeZone = await orgTimezone(supabase, orgId);
    const day = todayKey(new Date(), timeZone);

    const [{ data: jobs, error }, proofsResult, assignedResult] = await Promise.all([
      supabase
        .from('crm_jobs')
        .select('id, job_number, title, status, scheduled_start, property_id')
        .eq('org_id', orgId)
        .order('scheduled_start', { ascending: true, nullsFirst: false })
        .limit(200),
      supabase.from('job_proofs').select('job_id').eq('org_id', orgId).eq('work_date', day),
      supabase
        .from('job_assignments')
        .select('job_id')
        .eq('org_id', orgId)
        .eq('user_id', userId)
        .is('released_at', null),
    ]);

    if (error) throw new HttpError(500, error.message, 'field_jobs_failed');

    const filmedIds = [
      ...new Set(
        ((proofsResult.data ?? []) as { job_id?: string }[])
          .map((p) => p.job_id)
          .filter(Boolean),
      ),
    ] as string[];

    const assignedIds = new Set(
      ((assignedResult.data ?? []) as { job_id?: string }[])
        .map((row) => row.job_id)
        .filter(Boolean) as string[],
    );

    const inputs: TodayJobInput[] = ((jobs ?? []) as any[])
      .filter(
        (j) =>
          assignedIds.size === 0 ||
          assignedIds.has(j.id as string) ||
          filmedIds.includes(j.id as string),
      )
      .map((j) => ({
        id: j.id as string,
        jobNumber: (j.job_number as number | null) ?? null,
        title: (j.title as string | null) ?? null,
        status: (j.status as string | null) ?? null,
        scheduledStart: (j.scheduled_start as string | null) ?? null,
        propertyId: (j.property_id as string | null) ?? null,
      }));

    const picked = pickTodayJobs(inputs, filmedIds, day, timeZone);
    const propertyIds = [...new Set(picked.map((j) => j.propertyId).filter(Boolean))] as string[];
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

    const jobIds = picked.map((j) => j.id);
    const inviteByJob = new Map<string, string>();
    const email = req.user?.email ?? null;
    if (jobIds.length) {
      const { data: parties } = await supabase
        .from('job_parties')
        .select('job_id, email, access_token')
        .eq('org_id', orgId)
        .in('job_id', jobIds)
        .is('revoked_at', null);
      const invites = ((parties ?? []) as any[]).map((p) => ({
        jobId: p.job_id as string,
        email: (p.email as string | null) ?? null,
        accessToken: p.access_token as string,
      }));
      for (const job of picked) {
        const token = pickInviteToken(invites, job.id, email);
        if (token) inviteByJob.set(job.id, token);
      }
    }

    const missing = picked.filter((j) => !inviteByJob.has(j.id));
    if (missing.length) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', userId)
        .maybeSingle();
      const fullName = (profile as { full_name?: string } | null)?.full_name ?? null;
      await Promise.all(
        missing.map(async (job) => {
          try {
            const party = await ensureFieldParty(supabase, orgId, job.id, userId, email, fullName);
            if (party.access_token) inviteByJob.set(job.id, party.access_token);
          } catch {
            /* click still lists the job; they just cannot open a share link */
          }
        }),
      );
    }

    const out = picked.map((j) => {
      const token = inviteByJob.get(j.id) ?? null;
      return {
        id: j.id,
        number: j.jobNumber != null ? `#${j.jobNumber}` : '',
        name: j.title || 'Job',
        address: (j.propertyId && addressById.get(j.propertyId)) || 'Address on file',
        at: formatTodayAt(j.scheduledStart, j.filmed, timeZone),
        status: j.status ?? null,
        placed: Boolean(j.propertyId && addressById.get(j.propertyId)) || j.filmed,
        filmed: j.filmed,
        reason: j.reason,
        sharePath: token ? jobSharePagePath(token, email) : null,
      };
    });

    res.json({ jobs: out, today: day });
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
