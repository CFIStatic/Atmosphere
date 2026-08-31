import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { HttpError, badRequest } from '../lib/errors.js';
import { assessReadiness, type IntakeSource, type JobFacts } from '../verifier/readiness.js';
import { jobTitleForIntake, proposeIntakeFromText } from '../verifier/intakePropose.js';
import { jobSharePagePath } from '../lib/jobSharePath.js';
import { createAdminClient } from '../lib/supabase.js';
import {
  deliverPartyInvite,
  fieldCaptureInvitePath,
} from '../verifier/deliverPartyInvite.js';
import { recordAccess } from './proofOfWork.js';
import {
  intakeWriteError,
  isMemoryLedgerError,
  repairMemoryJobFk,
} from '../lib/memoryLedger.js';
import { placesProvider, resolvePlace } from '../lib/googlePlaces.js';
import {
  cityPostalFromAddress,
  propertyRowFromResolved,
  propertyRowFromTyped,
} from '../lib/propertyAddress.js';

/**
 * How a job gets here, and what that costs.
 *
 * Three doors: the customer's CRM syncs it, somebody uploads the scope
 * document, or a person types it before the crew leaves. Two of those are
 * already built. This file adds the third — the fastest possible hand entry —
 * and the thing all three were missing: a straight answer, before the truck
 * leaves, about what the footage from this job will actually be able to
 * establish.
 *
 * Readiness never blocks. The crew films regardless, because a crew standing
 * in a flooded basement must not be stopped by a missing field. What it does
 * is move the analyst's rule — unknown is never a pass — an hour earlier,
 * where the fix still costs nothing.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

type CrmJobRow = { id: string; title: string; job_number: number | null };

async function insertCrmJob(writer: any, row: Record<string, unknown>): Promise<CrmJobRow> {
  await repairMemoryJobFk();
  const attempt = () => writer.from('crm_jobs').insert(row).select('id, title, job_number').single();
  const first = await attempt();
  if (!first.error && first.data) return first.data as CrmJobRow;
  if (isMemoryLedgerError(first.error?.message)) {
    await repairMemoryJobFk();
    const retry = await attempt();
    if (!retry.error && retry.data) return retry.data as CrmJobRow;
    throw intakeWriteError(retry.error ?? first.error, 'Could not create the job.', 'job_failed');
  }
  throw intakeWriteError(first.error, 'Could not create the job.', 'job_failed');
}

export const jobIntakeRouter = Router();
jobIntakeRouter.use(requireAuth);

/**
 * Gather the facts readiness is computed from.
 *
 * Every query here is scoped to the one job, and a failure to read a table is
 * never treated as an absence — a swallowed error would silently report a
 * fully-specified job as missing its scope, which is the exact false alarm
 * that teaches people to ignore the panel.
 */
async function factsFor(supabase: any, jobId: string): Promise<JobFacts> {
  const { data: job, error: jobError } = await supabase
    .from('crm_jobs')
    .select('id, scheduled_start, property_id')
    .eq('id', jobId)
    .maybeSingle();
  if (jobError) throw new HttpError(500, 'Could not read the job.', 'job_read_failed');
  if (!job) throw new HttpError(404, 'That job does not exist.', 'job_not_found');

  const [scopeResult, partyResult, intakeResult, propertyResult] = await Promise.all([
    supabase.from('job_scope_items').select('id, source_document_id').eq('job_id', jobId),
    supabase.from('job_parties').select('id').eq('job_id', jobId).is('revoked_at', null),
    supabase.from('job_intake').select('source').eq('job_id', jobId).maybeSingle(),
    (job as any).property_id
      ? supabase
          .from('crm_properties')
          .select('address_line1, latitude, longitude')
          .eq('id', (job as any).property_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (scopeResult.error) throw new HttpError(500, 'Could not read the scope.', 'scope_read_failed');
  if (partyResult.error) throw new HttpError(500, 'Could not read the parties.', 'party_read_failed');
  if (propertyResult.error) throw new HttpError(500, 'Could not read the property.', 'property_read_failed');

  const scope = (scopeResult.data ?? []) as any[];
  const property = propertyResult.data as any;

  return {
    scopeLineCount: scope.length,
    scopeFromDocument: scope.some((s) => s.source_document_id),
    hasAddress: Boolean(property?.address_line1),
    hasCoordinates: property?.latitude !== null && property?.latitude !== undefined
      && property?.longitude !== null && property?.longitude !== undefined,
    scheduledStart: (job as any).scheduled_start ?? null,
    partyCount: (partyResult.data ?? []).length,
    intakeSource: ((intakeResult.data as any)?.source ?? null) as IntakeSource | null,
  };
}

/**
 * GET /api/operations/jobs/:jobId/readiness
 *
 * What this job can prove today, and what each gap costs.
 */
jobIntakeRouter.get(
  '/jobs/:jobId/readiness',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { supabase } = await requireOrgContext(req);
      const facts = await factsFor(supabase, req.params.jobId);
      res.json({ readiness: assessReadiness(facts), facts });
    } catch (err) {
      next(err);
    }
  },
);

/* ------------------------------------------------------------------ *
 * The typed-in job
 * ------------------------------------------------------------------ */

const quickStartSchema = z.object({
  title: z.string().min(1).max(200),
  workType: z.enum(['mitigation', 'construction']).default('construction'),
  address: z.string().min(1).max(200),
  city: z.string().max(120).optional(),
  postalCode: z.string().max(20).optional(),
  scheduledStart: z.string().datetime().optional(),
  // The scope, typed. Optional because a job with an address and no scope is
  // still worth creating — readiness will say exactly what that costs.
  scope: z
    .array(
      z.object({
        title: z.string().min(1).max(300),
        state: z.enum(['included', 'excluded']).default('included'),
        reason: z.string().max(500).optional(),
      }),
    )
    .max(60)
    .optional(),
});

/**
 * POST /api/operations/jobs/quick-start
 *
 * The whole job in one call: property, job, scope, provenance. This is the
 * "before they begin work" path, and it is one request because it is used
 * standing next to a truck — a four-screen wizard is a job that never gets
 * entered, and a job that never gets entered is footage nobody can verify.
 *
 * Ordering matters on failure. The property is created first because a job
 * without one is still a usable record, whereas a property with no job is
 * an orphan; and if the scope insert fails the job survives with its
 * readiness honestly reporting no scope, rather than the whole entry being
 * lost after somebody has typed it.
 */
jobIntakeRouter.post('/jobs/quick-start', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase, userId } = await requireOrgContext(req);
    const input = quickStartSchema.parse(req.body);
    const site = await resolveIntakeAddress(orgId, input);
    const jobTitle = jobTitleForIntake(input.title, site.line);

    const { data: property, error: propertyError } = await supabase
      .from('crm_properties')
      .insert(site.row)
      .select('id')
      .single();
    if (propertyError || !property) {
      throw new HttpError(500, 'Could not save the address.', 'property_failed');
    }

    const job = await insertCrmJob(supabase, {
      org_id: orgId,
      title: jobTitle,
      work_type: input.workType,
      property_id: (property as any).id,
      scheduled_start: input.scheduledStart ?? null,
      created_by: userId,
    });
    const jobId = job.id;

    // Provenance, written in the same breath as the job. A job whose intake
    // row is missing reads as "source unknown" forever, and there is no later
    // moment at which anyone could truthfully fill it in.
    await supabase.from('job_intake').insert({
      job_id: jobId,
      org_id: orgId,
      source: 'manual' satisfies IntakeSource,
      source_detail: { enteredFrom: 'quick_start' },
      entered_by: userId,
    });

    let scopeSaved = 0;
    if (input.scope?.length) {
      const { data: lines, error: scopeError } = await supabase
        .from('job_scope_items')
        .insert(
          input.scope.map((line) => ({
            org_id: orgId,
            job_id: jobId,
            title: line.title,
            state: line.state,
            reason: line.reason ?? null,
            created_by: userId,
          })),
        )
        .select('id');
      // Reported rather than thrown: the job exists and is worth keeping.
      if (!scopeError) scopeSaved = (lines ?? []).length;
    }

    await recordAccess(supabase, {
      orgId,
      jobId,
      action: 'job_created',
      actorId: userId,
      actorLabel: 'Office',
      detail: `Job entered by hand with ${scopeSaved} scope ${scopeSaved === 1 ? 'line' : 'lines'}`,
    }).catch(() => undefined);

    const facts = await factsFor(supabase, jobId);
    res.status(201).json({
      job: { id: jobId, title: (job as any).title, jobNumber: (job as any).job_number ?? null },
      scopeSaved,
      // Returned immediately so the person who just typed it sees, on the same
      // screen, what they still owe the job before the crew films it.
      readiness: assessReadiness(facts),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/operations/intake-mix
 *
 * How this org's jobs are arriving. Counting is the point: an org whose jobs
 * are almost all typed by hand is an org whose CRM is not connected yet, and
 * that is worth knowing without asking them.
 */
jobIntakeRouter.get('/intake-mix', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const { data, error } = await supabase.from('job_intake').select('source').eq('org_id', orgId);
    if (error) throw new HttpError(500, 'Could not read intake.', 'intake_read_failed');

    const counts: Record<string, number> = { crm_sync: 0, scope_document: 0, manual: 0, party_link: 0 };
    for (const row of (data ?? []) as any[]) {
      if (row.source in counts) counts[row.source] += 1;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    res.json({ counts, total, recorded: total });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ *
 * AI-first intake package (no money)
 * ------------------------------------------------------------------ *
 * Paste / drop scope → editable proposal → invite Field Capture team
 * (preloaded from org field technicians) → one Approve.
 * Creates job + scope + published brief + capture invite links together.
 */

const proposeSchema = z
  .object({
    /** Scope / claim paste. Optional when a site address is provided. */
    text: z.string().trim().max(80_000).optional().default(''),
    /** Site address — enough on its own to draft a job without scope. */
    address: z.string().trim().max(200).optional(),
  })
  .superRefine((value, ctx) => {
    if (!(value.address?.trim()) && (value.text?.trim().length ?? 0) < 20) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter the site address.',
        path: ['address'],
      });
    }
  });

type CaptureTeamMember = {
  userId: string;
  fullName: string;
  email: string | null;
  role: string;
  workType: string | null;
  /** Pre-selected for invite on this job. */
  selected: boolean;
};

async function loadCaptureTeam(supabase: any, orgId: string): Promise<CaptureTeamMember[]> {
  const { data, error } = await supabase
    .from('org_members')
    .select('user_id, role, work_type, usage_intents, status, profiles(email, full_name)')
    .eq('org_id', orgId)
    .eq('status', 'active');
  if (error) throw new HttpError(500, 'Could not load the Field Capture team.', 'team_read_failed');

  const rows = (data ?? []) as any[];
  const fieldTechs = rows.filter((r) => r.role === 'field_technician');
  const fieldAdjacent = rows.filter(
    (r) =>
      (Array.isArray(r.usage_intents) && r.usage_intents.includes('field_work'))
      || r.work_type === 'mitigation'
      || r.work_type === 'construction',
  );
  // Prefer field technicians; if none, fall back to people marked for field work.
  const pool = fieldTechs.length > 0 ? fieldTechs : fieldAdjacent;

  return pool.map((r) => {
    const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
    return {
      userId: String(r.user_id),
      fullName: String(p?.full_name || p?.email || 'Field technician'),
      email: (p?.email as string) ?? null,
      role: String(r.role),
      workType: (r.work_type as string) ?? null,
      selected: true,
    };
  });
}

jobIntakeRouter.post('/intake/propose', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const { text, address } = proposeSchema.parse(req.body ?? {});
    let proposal;
    try {
      proposal = proposeIntakeFromText(text ?? '', { address });
    } catch (err) {
      throw badRequest(err instanceof Error ? err.message : 'Could not read that text.', 'propose_failed');
    }
    const captureTeam = await loadCaptureTeam(supabase, orgId);
    res.json({ proposal, captureTeam });
  } catch (err) {
    next(err);
  }
});

const inviteeSchema = z
  .object({
    userId: z.string().trim().min(1).max(80).optional(),
    fullName: z.string().trim().min(1).max(120),
    /** Company / crew label when inviting someone outside the org. */
    company: z.string().trim().min(1).max(160).optional(),
    email: z.string().trim().email().max(200).nullable().optional(),
    trade: z.string().trim().max(60).optional(),
    /** Outside the org — mainly subcontractors invited by email. */
    external: z.boolean().optional(),
  })
  .superRefine((person, ctx) => {
    // Org teammates can ride a seat without an inbox. Outsiders need email —
    // that is how the invite reaches them and how the job finds their account.
    if ((person.external || !person.userId) && !person.email) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Email is required to invite someone outside the company.',
        path: ['email'],
      });
    }
  });

const approveSchema = z.object({
  title: z.string().trim().min(1).max(200),
  workType: z.enum(['mitigation', 'construction']).default('mitigation'),
  address: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((value) => value.toLowerCase() !== 'address to confirm', {
      message: 'Enter the real site address before inviting Field Capture.',
    }),
  city: z.string().trim().max(120).optional(),
  postalCode: z.string().trim().max(20).optional(),
  region: z.string().trim().max(120).optional(),
  country: z.string().trim().max(8).optional(),
  placeId: z.string().trim().max(300).optional(),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  claimNumber: z.string().trim().max(80).optional(),
  briefNote: z.string().trim().max(2000).nullable().optional(),
  facts: z.record(z.string().max(80), z.string().max(2000)).optional(),
  /** Optional — empty means AI will describe the video instead of cross-referencing lines. */
  scope: z
    .array(
      z.object({
        // Matches job_scope_items title check (2–200).
        title: z.string().trim().min(2).max(200),
        state: z.enum(['included', 'excluded']).default('included'),
        reason: z.string().max(1000).optional(),
      }),
    )
    .max(60)
    .default([]),
  /** Optional — org members can still film from Field Capture once the job exists. */
  invitees: z.array(inviteeSchema).max(20).default([]),
});

type CreatedParty = {
  id: string;
  name: string;
  email: string | null;
  token: string;
  external: boolean;
};

type CreatedJobFile = {
  job: { id: string; title: string; jobNumber: number | null };
  briefRevision: number;
  scopeSaved: number;
  parties: CreatedParty[];
  summary: {
    jobId: string;
    jobNumber: number | null;
    title: string;
    status: string;
    parties: number;
    currentRevision: number | null;
    behind: number;
    awaiting: number;
    exclusions: number;
  };
};

function scopeLinesForDb(input: z.infer<typeof approveSchema>) {
  return (input.scope ?? [])
    .map((line) => ({
      title: line.title.trim().slice(0, 200),
      state: line.state,
      reason: line.reason?.trim() ? line.reason.trim().slice(0, 1000) : undefined,
    }))
    .filter((line) => line.title.length >= 2);
}

type IntakeAddress = {
  line: string;
  city?: string;
  postalCode?: string;
  row: Record<string, unknown>;
};

async function resolveIntakeAddress(
  orgId: string,
  input: {
    address: string;
    city?: string;
    postalCode?: string;
    placeId?: string;
  },
): Promise<IntakeAddress> {
  const parsed = cityPostalFromAddress(input.address);
  const resolved = await resolvePlace({
    query: input.address,
    placeId: input.placeId,
  });
  if (resolved?.address) {
    const row = propertyRowFromResolved(orgId, resolved.address, input.address);
    const line = String(row.address_line1 ?? input.address).slice(0, 200);
    return {
      line,
      city: (row.city as string | null) || input.city || parsed.city || undefined,
      postalCode: (row.postal_code as string | null) || input.postalCode || parsed.postalCode || undefined,
      row,
    };
  }
  if (placesProvider() === 'google') {
    throw new HttpError(
      400,
      'Search for the site address and pick it from the Google results.',
      'address_unresolved',
    );
  }
  const row = propertyRowFromTyped(orgId, input.address, input.city, input.postalCode);
  return {
    line: String(row.address_line1 ?? input.address).slice(0, 200),
    city: (row.city as string | null) || undefined,
    postalCode: (row.postal_code as string | null) || undefined,
    row,
  };
}

/**
 * Preferred path: one SECURITY DEFINER transaction that creates the full job
 * file. Falls back to stepwise inserts when the migration is not applied yet.
 */
export async function createJobFile(
  supabase: any,
  orgId: string,
  userId: string,
  input: z.infer<typeof approveSchema>,
): Promise<CreatedJobFile> {
  const site = await resolveIntakeAddress(orgId, input);
  const scopeLines = scopeLinesForDb(input);
  const jobTitle = jobTitleForIntake(input.title, site.line);
  const invitees = input.invitees.map((person) => ({
    userId: person.userId ?? null,
    fullName: person.fullName,
    company: person.company ?? null,
    email: person.email?.trim().toLowerCase() || null,
    trade: person.trade ?? null,
    external: Boolean(person.external || !person.userId),
  }));

  const rpcArgs = {
    p_org_id: orgId,
    p_title: jobTitle,
    p_work_type: input.workType,
    p_address: site.line,
    p_city: site.city ?? null,
    p_postal_code: site.postalCode ?? null,
    p_claim_number: input.claimNumber ?? null,
    p_brief_note: input.briefNote ?? null,
    p_facts: input.facts ?? {},
    p_scope: scopeLines,
    p_invitees: invitees,
  };

  await repairMemoryJobFk();
  let rpc =
    invitees.length > 0
      ? await supabase.rpc('intake_create_job_file', rpcArgs)
      : { error: null, data: null };

  if (rpc.error && isMemoryLedgerError(rpc.error.message) && invitees.length > 0) {
    await repairMemoryJobFk();
    rpc = await supabase.rpc('intake_create_job_file', rpcArgs);
  }

  if (!rpc.error && rpc.data) {
    const payload = rpc.data as any;
    const job = payload.job ?? {};
    const parties = (payload.parties ?? []) as CreatedParty[];
    const summary = payload.summary ?? {
      jobId: job.id,
      jobNumber: job.jobNumber ?? null,
      title: job.title,
      status: 'scheduled',
      parties: parties.length,
      currentRevision: payload.briefRevision ?? 1,
      behind: 0,
      awaiting: parties.length,
      exclusions: scopeLines.filter((s) => s.state === 'excluded').length,
    };
    return {
      job: {
        id: String(job.id),
        title: String(job.title ?? input.title),
        jobNumber: job.jobNumber ?? null,
      },
      briefRevision: Number(payload.briefRevision ?? 1),
      scopeSaved: Number(payload.scopeSaved ?? scopeLines.length),
      parties: parties.map((p) => ({
        id: String(p.id),
        name: String(p.name),
        email: p.email ?? null,
        token: String(p.token),
        external: Boolean(p.external),
      })),
      summary: {
        jobId: String(summary.jobId ?? job.id),
        jobNumber: summary.jobNumber ?? job.jobNumber ?? null,
        title: String(summary.title ?? job.title ?? input.title),
        status: String(summary.status ?? 'scheduled'),
        parties: Number(summary.parties ?? parties.length),
        currentRevision: summary.currentRevision ?? payload.briefRevision ?? 1,
        behind: Number(summary.behind ?? 0),
        awaiting: Number(summary.awaiting ?? parties.length),
        exclusions: Number(summary.exclusions ?? 0),
      },
    };
  }

  // RPC missing / failed — create stepwise so older databases still work.
  if (rpc.error) {
    const msg = String(rpc.error.message ?? rpc.error);
    const missingFn = /intake_create_job_file|function .* does not exist|PGRST202/i.test(msg);
    if (!missingFn) {
      console.warn('[intake] intake_create_job_file failed, falling back:', msg);
    }
  }
  return createJobFileStepwise(supabase, orgId, userId, input, scopeLines, invitees, site);
}

async function createJobFileStepwise(
  supabase: any,
  orgId: string,
  userId: string,
  input: z.infer<typeof approveSchema>,
  scopeLines: ReturnType<typeof scopeLinesForDb>,
  invitees: Array<{
    userId: string | null;
    fullName: string;
    company: string | null;
    email: string | null;
    trade: string | null;
    external: boolean;
  }>,
  site: IntakeAddress,
): Promise<CreatedJobFile> {
  // Prefer the service-role client for the write path when available so a
  // missing GRANT on job_* tables cannot strand a half-created job file.
  const writer = createAdminClient() ?? supabase;
  const jobTitle = jobTitleForIntake(input.title, site.line);

  let property = (
    await writer.from('crm_properties').insert(site.row).select('id').single()
  ) as { data: { id: string } | null; error: { message?: string } | null };
  if (property.error || !property.data) {
    property = await writer
      .from('crm_properties')
      .insert({
        org_id: orgId,
        address_line1: site.line,
        city: site.city ?? null,
        postal_code: site.postalCode ?? null,
      })
      .select('id')
      .single();
  }
  if (property.error || !property.data) {
    throw intakeWriteError(property.error, 'Could not save the address.', 'property_failed');
  }

  const job = await insertCrmJob(writer, {
    org_id: orgId,
    title: jobTitle,
    work_type: input.workType,
    property_id: property.data.id,
    claim_number: input.claimNumber || null,
    status: 'scheduled',
    created_by: userId,
  });
  const jobId = job.id;

  const { error: intakeError } = await writer.from('job_intake').insert({
    job_id: jobId,
    org_id: orgId,
    source: (scopeLines.length ? 'scope_document' : 'manual') satisfies IntakeSource,
    source_detail: {
      enteredFrom: 'intake_package',
      captureInvites: invitees.length,
      scopeOptional: scopeLines.length === 0,
    },
    entered_by: userId,
  });
  if (intakeError) {
    console.warn('[intake] job_intake insert failed:', intakeError.message);
  }

  const { data: brief, error: briefError } = await writer
    .from('job_briefs')
    .insert({
      org_id: orgId,
      job_id: jobId,
      revision: 0,
      facts: input.facts ?? {},
      note: input.briefNote ?? null,
      created_by: userId,
    })
    .select('id, revision')
    .single();
  if (briefError || !brief) {
    throw intakeWriteError(briefError, 'Could not publish the brief.', 'brief_failed');
  }
  const revision = (brief as any).revision ?? 1;

  if (scopeLines.length) {
    const inserted = await writer
      .from('job_scope_items')
      .insert(
        scopeLines.map((line) => ({
          org_id: orgId,
          job_id: jobId,
          title: line.title,
          state: line.state,
          reason: line.reason ?? null,
          revision,
          created_by: userId,
        })),
      )
      .select('id');
    if (inserted.error) {
      throw intakeWriteError(inserted.error, 'Could not save scope lines.', 'scope_failed');
    }
  }

  const parties: CreatedParty[] = [];
  for (const person of invitees) {
    const company = (person.company?.trim() || person.fullName).slice(0, 160);
    const { data: party, error: partyError } = await writer
      .from('job_parties')
      .insert({
        org_id: orgId,
        job_id: jobId,
        company,
        trade: person.trade || (person.external ? 'subcontractor' : 'field_capture'),
        contact_name: person.fullName,
        email: person.email,
        role: 'subcontractor',
        invited_at: new Date().toISOString(),
        created_by: userId,
      })
      .select('id, company, access_token, email')
      .single();
    if (partyError || !party) {
      throw intakeWriteError(
        partyError,
        `Could not invite ${person.fullName}.`,
        'party_failed',
      );
    }
    parties.push({
      id: String((party as any).id),
      name: String((party as any).company ?? company),
      email: ((party as any).email as string) ?? person.email,
      token: String((party as any).access_token),
      external: person.external,
    });
  }

  return {
    job: {
      id: jobId,
      title: (job as any).title,
      jobNumber: (job as any).job_number ?? null,
    },
    briefRevision: revision,
    scopeSaved: scopeLines.length,
    parties,
    summary: {
      jobId,
      jobNumber: (job as any).job_number ?? null,
      title: (job as any).title,
      status: 'scheduled',
      parties: parties.length,
      currentRevision: revision,
      behind: 0,
      awaiting: parties.length,
      exclusions: scopeLines.filter((s) => s.state === 'excluded').length,
    },
  };
}

/**
 * POST /api/operations/intake/approve
 * One approval: job file + scope + published brief + Field Capture invites.
 * The job file is what the Dashboard lists — videos file into it later.
 */
jobIntakeRouter.post('/intake/approve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase, userId } = await requireOrgContext(req);
    const input = approveSchema.parse(req.body ?? {});

    const created = await createJobFile(supabase, orgId, userId, input);
    const jobId = created.job.id;
    const siteAddress = [input.address, input.city, input.postalCode]
      .map((part) => (part ?? '').trim())
      .filter(Boolean)
      .join(', ');

    const invites: Array<{
      id: string;
      name: string;
      email: string | null;
      sharePath: string;
      fieldCapturePath: string;
      token: string;
      external: boolean;
      emailed: boolean;
      recipientHasAccount: boolean;
      attachedToAccount: boolean;
    }> = [];

    for (const party of created.parties) {
      const delivery = await deliverPartyInvite({
        supabase,
        orgId,
        jobId,
        jobTitle: created.job.title,
        siteAddress,
        userId,
        partyId: party.id,
        company: party.name,
        contactName: party.name,
        email: party.email,
        token: party.token,
      });
      invites.push({
        id: party.id,
        name: party.name,
        email: party.email,
        token: party.token,
        sharePath: jobSharePagePath(party.token, party.email),
        fieldCapturePath: fieldCaptureInvitePath(party.token),
        external: party.external,
        emailed: delivery.emailed,
        recipientHasAccount: delivery.recipientHasAccount,
        attachedToAccount: delivery.attachedToAccount,
      });
    }

    const emailedCount = invites.filter((i) => i.emailed).length;
    await recordAccess(supabase, {
      orgId,
      jobId,
      action: 'uploaded',
      actorId: userId,
      actorLabel: 'Office',
      detail: `Intake approved — ${created.scopeSaved} scope lines, brief r${created.briefRevision}, ${invites.length} invite(s)${emailedCount ? `, ${emailedCount} emailed` : ''}`,
    }).catch(() => undefined);

    // Confirm the job file is listable before telling the client it exists.
    const { data: listed, error: listError } = await supabase
      .from('crm_jobs')
      .select('id')
      .eq('org_id', orgId)
      .eq('id', jobId)
      .maybeSingle();
    if (listError || !listed) {
      console.warn(
        '[intake] job created but not yet visible to org list:',
        listError?.message ?? 'missing row',
      );
    }

    const facts = await factsFor(supabase, jobId).catch(async () => ({
      scopeLineCount: created.scopeSaved,
      scopeFromDocument: created.scopeSaved > 0,
      hasAddress: true,
      hasCoordinates: false,
      scheduledStart: null as string | null,
      partyCount: created.parties.length,
      intakeSource: (created.scopeSaved > 0 ? 'scope_document' : 'manual') as IntakeSource,
    }));
    const primary = invites[0]!;
    res.status(201).json({
      job: created.job,
      briefRevision: created.briefRevision,
      scopeSaved: created.scopeSaved,
      invites,
      jobFile: created.summary,
      // Back-compat for older UI: first invitee
      party: { id: primary.id, company: primary.name },
      sharePath: primary.sharePath,
      fieldCapturePath: primary.fieldCapturePath,
      readiness: assessReadiness(facts),
    });
  } catch (err) {
    next(err);
  }
});
