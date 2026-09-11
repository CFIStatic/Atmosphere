import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { Session, User } from '@supabase/supabase-js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { unscopedAdmin, writerForOrg } from '../lib/scopedAdmin.js';
import {
  claimInvitedPartiesForUser,
  normalizeInviteEmail,
  partiesInvitedToEmail,
} from '../shared/inviteeJobAccess.js';
import { listTombstonedJobIds } from '../lib/jobFileDelete.js';
import { badRequest, HttpError, serviceUnavailable } from '../lib/errors.js';
import { setSessionCookies } from '../lib/session.js';
import {
  fieldOfficeSchema,
  fieldRegisterSchema,
} from '../lib/validation.js';
import { createPasswordAccount, publicUser, sessionTokens } from '../auth/passwordAccount.js';
import { clientIp, clientUserAgent } from '../legal/terms.js';
import { recordTermsAcceptance, requireAcceptedTermsVersion } from '../legal/termsStore.js';
import { linkFieldOffice } from '../field/officeLink.js';
import { authLimiter } from './auth.js';
import {
  completeChunkedProofUpload,
  createPartUploadUrl,
  createUploadUrl,
  recordProof,
} from './proofOfWork.js';
import {
  DEFAULT_FIELD_TIMEZONE,
  formatTodayAt,
  pickInviteToken,
  pickTodayJobs,
  todayJobLocation,
  todayKey,
  type TodayJobInput,
} from '../field/todayJobs.js';
import { jobSharePagePath } from '../lib/jobSharePath.js';
import { isDisplayableAvatarUrl } from '../lib/avatar.js';
import { fieldStartJobSchema } from '../lib/validation.js';
import { intakeFromFieldStart } from '../field/startJob.js';
import { createJobFile } from './jobIntake.js';
import {
  autocompletePlaces,
  detailsForPlace,
  placesProvider,
  resolvePlace,
} from '../lib/googlePlaces.js';

/**
 * Field Capture (App Store) ↔ platform account bridge.
 *
 * Crew join with the same email/password as the office, after a Global Admin
 * invite. Day films land in `job_proofs` on the office record.
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
      requireAcceptedTermsVersion(input.acceptedTermsVersion);
      const created = await createPasswordAccount(input.email, input.password);

      if (created.kind === 'error') throw created.error;

      if (created.kind === 'confirm') {
        if (created.user?.id) {
          await recordTermsAcceptance({
            userId: created.user.id,
            termsVersion: input.acceptedTermsVersion,
            ip: clientIp(req),
            userAgent: clientUserAgent(req),
          });
        }
        res.status(201).json({
          user: created.user ? publicUser(created.user) : null,
          needsEmailConfirmation: true,
          message: created.message,
          org: null,
        });
        return;
      }

      await recordTermsAcceptance({
        userId: created.user.id,
        accessToken: created.session.access_token,
        termsVersion: input.acceptedTermsVersion,
        ip: clientIp(req),
        userAgent: clientUserAgent(req),
      });

      try {
        const org = await linkFieldOffice(created.session.access_token, created.user, {
          fullName: input.fullName,
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
 * Link an already-signed-in Field Capture user to an office (pending email
 * invite, or a new organization name).
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
    const userId = req.user!.id;
    try {
      const ctx = await requireOrgContext(req);
      const { data: org } = await ctx.supabase
        .from('orgs')
        .select('id, name')
        .eq('id', ctx.orgId)
        .maybeSingle();
      const { data: profile } = await ctx.supabase
        .from('profiles')
        .select('full_name, avatar_url')
        .eq('id', userId)
        .maybeSingle();
      const row = profile as { full_name?: string; avatar_url?: string | null } | null;
      res.json({
        user: {
          id: userId,
          email: req.user?.email ?? null,
          fullName: row?.full_name ?? null,
          avatarUrl: isDisplayableAvatarUrl(row?.avatar_url) ? (row?.avatar_url ?? null) : null,
        },
        org: {
          id: ctx.orgId,
          name: (org as { name?: string } | null)?.name ?? 'Organization',
          role: ctx.role,
        },
      });
      return;
    } catch (err) {
      if (!(err instanceof HttpError) || err.code !== 'no_organization') throw err;
      res.json({
        user: {
          id: userId,
          email: req.user?.email ?? null,
          fullName: null,
          avatarUrl: null,
        },
        org: null,
      });
    }
  } catch (err) {
    next(err);
  }
});

/**
 * Capture invitees are not org_members. Today is every live party invite
 * emailed to this account — never another recipient, never the vendor's list.
 */
async function listInviteeToday(req: Request) {
  const email = normalizeInviteEmail(req.user?.email);
  const timeZone = DEFAULT_FIELD_TIMEZONE;
  const day = todayKey(new Date(), timeZone);
  if (!email || !req.user) return { jobs: [], today: day, access: 'invitee' as const };

  const admin = unscopedAdmin();
  await claimInvitedPartiesForUser(admin, req.user);

  const { data: parties } = await admin
    .from('job_parties')
    .select('job_id, email, access_token, revoked_at')
    .eq('email', email)
    .is('revoked_at', null);
  const mine = partiesInvitedToEmail(
    ((parties ?? []) as Array<{
      job_id: string;
      email?: string | null;
      access_token: string;
      revoked_at?: string | null;
    }>),
    email,
  );
  const jobIds = [...new Set(mine.map((p) => p.job_id))];
  if (!jobIds.length) return { jobs: [], today: day, access: 'invitee' as const };

  const { data: jobs } = await admin
    .from('crm_jobs')
    .select('id, job_number, title, status, scheduled_start, property_id')
    .in('id', jobIds)
    .is('deleted_at', null);

  const tokenByJob = new Map<string, string>();
  for (const party of mine) {
    if (party.access_token && !tokenByJob.has(party.job_id)) {
      tokenByJob.set(party.job_id, party.access_token);
    }
  }

  const inputs: TodayJobInput[] = ((jobs ?? []) as any[]).map((j) => ({
    id: j.id as string,
    jobNumber: (j.job_number as number | null) ?? null,
    title: (j.title as string | null) ?? null,
    status: (j.status as string | null) ?? null,
    scheduledStart: (j.scheduled_start as string | null) ?? null,
    propertyId: (j.property_id as string | null) ?? null,
  }));
  const picked = pickTodayJobs(inputs, [], day, timeZone);
  const out = picked.map((j) => {
    const token = tokenByJob.get(j.id) ?? null;
    return {
      id: j.id,
      number: j.jobNumber != null ? `#${j.jobNumber}` : '',
      name: j.title || 'Job',
      address: '',
      at: formatTodayAt(j.scheduledStart, false, timeZone),
      status: j.status ?? null,
      placed: true,
      filmed: false,
      reason: j.reason,
      sharePath: token ? jobSharePagePath(token, email) : null,
    };
  });
  return { jobs: out, today: day, access: 'invitee' as const };
}

async function orgTimezone(
  _supabase: Awaited<ReturnType<typeof requireOrgContext>>['supabase'],
  _orgId: string,
): Promise<string> {
  // pm_automation_settings dropped — Field Capture uses the default timezone.
  return DEFAULT_FIELD_TIMEZONE;
}

/**
 * GET /api/field-app/today
 * Every open job this person can add video to. If the office has put them on
 * a crew, only those jobs (plus anything they already filmed today, or a job
 * they started from Field Capture) show. Until then, the org's open jobs still
 * appear so the first day of filming is not blocked on an assignment — and a
 * missing start date never hides a job.
 */
fieldAppRouter.get('/today', async (req: Request, res: Response, next: NextFunction) => {
  try {
    let orgId: string;
    let userId: string;
    let supabase: Awaited<ReturnType<typeof requireOrgContext>>['supabase'];
    try {
      const ctx = await requireOrgContext(req);
      orgId = ctx.orgId;
      userId = ctx.userId;
      supabase = ctx.supabase;
    } catch (err) {
      if (!(err instanceof HttpError) || err.code !== 'no_organization') throw err;
      res.json(await listInviteeToday(req));
      return;
    }
    const timeZone = await orgTimezone(supabase, orgId);
    const day = todayKey(new Date(), timeZone);

    const [{ data: jobs, error }, proofsResult, assignedResult] = await Promise.all([
      supabase
        .from('crm_jobs')
        .select('id, job_number, title, status, scheduled_start, property_id, created_by')
        .eq('org_id', orgId)
        .is('deleted_at', null)
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

    const tombstoned = await listTombstonedJobIds(writerForOrg(orgId, supabase).raw, orgId);
    const inputs: TodayJobInput[] = ((jobs ?? []) as any[])
      .filter((j) => !tombstoned.has(j.id as string))
      .filter(
        (j) =>
          assignedIds.size === 0 ||
          assignedIds.has(j.id as string) ||
          filmedIds.includes(j.id as string) ||
          j.created_by === userId,
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
      const site = todayJobLocation(
        j.propertyId,
        j.propertyId ? addressById.get(j.propertyId) : undefined,
        j.filmed,
      );
      return {
        id: j.id,
        number: j.jobNumber != null ? `#${j.jobNumber}` : '',
        name: j.title || 'Job',
        address: site.address,
        at: formatTodayAt(j.scheduledStart, j.filmed, timeZone),
        status: j.status ?? null,
        placed: site.placed,
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

/** GET /api/field-app/places/status */
fieldAppRouter.get('/places/status', (_req: Request, res: Response) => {
  const provider = placesProvider();
  res.json({ configured: true, provider, google: provider === 'google' });
});

/** POST /api/field-app/places/autocomplete */
fieldAppRouter.post('/places/autocomplete', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = String((req.body as { input?: string } | null)?.input ?? '').trim();
    if (input.length < 2 || input.length > 200) {
      throw badRequest('Enter a street to search.', 'address_required');
    }
    const sessionToken = String((req.body as { sessionToken?: string } | null)?.sessionToken ?? '').trim();
    const { suggestions, provider } = await autocompletePlaces(
      input,
      sessionToken.length >= 8 ? sessionToken : undefined,
    );
    res.json({ suggestions, configured: true, provider });
  } catch (err) {
    next(err);
  }
});

/** POST /api/field-app/places/details */
fieldAppRouter.post('/places/details', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const placeId = String((req.body as { placeId?: string } | null)?.placeId ?? '').trim();
    if (placeId.length < 3) throw badRequest('Pick an address from the list.', 'place_required');
    const sessionToken = String((req.body as { sessionToken?: string } | null)?.sessionToken ?? '').trim();
    const { address, provider } = await detailsForPlace(
      placeId,
      sessionToken.length >= 8 ? sessionToken : undefined,
    );
    res.json({ address, configured: true, provider });
  } catch (err) {
    next(err);
  }
});

/** POST /api/field-app/places/resolve */
fieldAppRouter.post('/places/resolve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = String((req.body as { input?: string } | null)?.input ?? '').trim();
    const placeId = String((req.body as { placeId?: string } | null)?.placeId ?? '').trim();
    if (!query && !placeId) throw badRequest('Enter an address to look up.', 'address_required');
    const resolved = await resolvePlace({ query: query || undefined, placeId: placeId || undefined });
    if (!resolved || !(resolved.address.addressLine1 || resolved.address.formatted)) {
      throw badRequest('Search for the site address and pick it from the list.', 'address_unresolved');
    }
    res.json({ address: resolved.address, configured: true, provider: resolved.provider });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/field-app/jobs
 * Crew starts a job from Field Capture: name, optional note, then film.
 * The job file is the same record office intake would have created.
 */
fieldAppRouter.post('/jobs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, userId, supabase } = await requireOrgContext(req);
    const input = fieldStartJobSchema.parse(req.body ?? {});
    const created = await createJobFile(supabase, orgId, userId, intakeFromFieldStart(input), {
      allowTypedFallback: true,
    });
    const jobId = created.job.id;

    const { error: assignError } = await supabase.from('job_assignments').insert({
      org_id: orgId,
      job_id: jobId,
      user_id: userId,
      role_on_job: 'crew',
    });
    if (assignError && assignError.code !== '23505') {
      console.warn('[field-app] could not assign creator to new job:', assignError.message);
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', userId)
      .maybeSingle();
    const email = req.user?.email ?? null;
    let sharePath: string | null = null;
    try {
      const party = await ensureFieldParty(
        supabase,
        orgId,
        jobId,
        userId,
        email,
        (profile as { full_name?: string } | null)?.full_name,
      );
      if (party.access_token) sharePath = jobSharePagePath(party.access_token, email);
    } catch {
      /* job exists; they can still film through the signed-in proof path */
    }

    res.status(201).json({
      job: {
        id: jobId,
        number: created.job.jobNumber != null ? `#${created.job.jobNumber}` : '',
        name: created.job.title,
        address: '',
        at: '',
        status: created.summary.status,
        placed: true,
        filmed: false,
        sharePath,
      },
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
  try {
    return unscopedAdmin();
  } catch {
    throw serviceUnavailable('Storage admin is not configured.', 'admin_unavailable');
  }
}

type ProofPartyRow = {
  id: string;
  org_id: string;
  job_id: string;
  company: string;
  access_token: string;
};

/**
 * The party row `createUploadUrl` / `recordProof` expect (the shape
 * `partyForToken` returns for job-share tokens), for the signed-in crew
 * member filing on one of the office's jobs.
 */
async function fieldProofParty(req: Request) {
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
  const partyRow: ProofPartyRow = {
    id: party.id,
    org_id: orgId,
    job_id: req.params.jobId,
    company: party.company,
    access_token: party.access_token,
  };
  return { admin, partyRow };
}

function proofRoute(
  handler: (
    party: ProofPartyRow,
    admin: Awaited<ReturnType<typeof adminOrThrow>>,
    body: unknown,
  ) => Promise<unknown>,
  status: 200 | 201 = 200,
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { partyRow, admin } = await fieldProofParty(req);
      res.status(status).json(await handler(partyRow, admin, req.body));
    } catch (err) {
      if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid request'));
      else next(err);
    }
  };
}

/**
 * The crew's side, in the order the phone calls them: somewhere to put the
 * film, the bytes (whole, resumed in parts, or streamed while still filming),
 * then the record of how it was filmed.
 */
/** POST /api/field-app/jobs/:jobId/proof/upload-url */
fieldAppRouter.post('/jobs/:jobId/proof/upload-url', proofRoute(createUploadUrl));

/** POST /api/field-app/jobs/:jobId/proof/upload-part-url — one slice of a film still being recorded. */
fieldAppRouter.post('/jobs/:jobId/proof/upload-part-url', proofRoute(createPartUploadUrl));

/** POST /api/field-app/jobs/:jobId/proof/upload-complete — stitch resumed or streamed parts. */
fieldAppRouter.post('/jobs/:jobId/proof/upload-complete', proofRoute(completeChunkedProofUpload));

/** POST /api/field-app/jobs/:jobId/proof — file the uploaded day film into the org record. */
fieldAppRouter.post('/jobs/:jobId/proof', proofRoute(recordProof, 201));
