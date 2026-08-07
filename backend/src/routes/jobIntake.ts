import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { HttpError, badRequest } from '../lib/errors.js';
import { assessReadiness, type IntakeSource, type JobFacts } from '../verifier/readiness.js';
import { proposeIntakeFromText } from '../verifier/intakePropose.js';
import { partyInviteEmail } from '../verifier/partyInviteEmail.js';
import { sendSystemMail } from '../lib/systemMail.js';
import { createAdminClient } from '../lib/supabase.js';
import { config } from '../config.js';
import { recordAccess } from './proofOfWork.js';

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

    const { data: property, error: propertyError } = await supabase
      .from('crm_properties')
      .insert({
        org_id: orgId,
        address_line1: input.address,
        city: input.city ?? null,
        postal_code: input.postalCode ?? null,
      })
      .select('id')
      .single();
    if (propertyError || !property) {
      throw new HttpError(500, 'Could not save the address.', 'property_failed');
    }

    const { data: job, error: jobError } = await supabase
      .from('crm_jobs')
      .insert({
        org_id: orgId,
        title: input.title,
        work_type: input.workType,
        property_id: (property as any).id,
        scheduled_start: input.scheduledStart ?? null,
        created_by: userId,
      })
      .select('id, title, job_number')
      .single();
    if (jobError || !job) throw new HttpError(500, 'Could not create the job.', 'job_failed');

    const jobId = (job as any).id;

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

const proposeSchema = z.object({
  text: z.string().trim().min(20).max(80_000),
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
    const { text } = proposeSchema.parse(req.body ?? {});
    let proposal;
    try {
      proposal = proposeIntakeFromText(text);
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
  address: z.string().trim().min(1).max(200),
  city: z.string().trim().max(120).optional(),
  postalCode: z.string().trim().max(20).optional(),
  claimNumber: z.string().trim().max(80).optional(),
  briefNote: z.string().trim().max(2000).nullable().optional(),
  facts: z.record(z.string().max(80), z.string().max(2000)).optional(),
  scope: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(300),
        state: z.enum(['included', 'excluded']).default('included'),
        reason: z.string().max(500).optional(),
      }),
    )
    .min(1)
    .max(60),
  /** Field Capture teammates and/or external subcontractors invited to film. */
  invitees: z.array(inviteeSchema).min(1).max(20),
});

async function actorLabelFor(supabase: any, userId: string): Promise<string> {
  const { data } = await supabase
    .from('profiles')
    .select('full_name, email')
    .eq('id', userId)
    .maybeSingle();
  return (data as any)?.full_name ?? (data as any)?.email ?? 'Office';
}

/**
 * Best-effort: email the capture invite, and if this inbox already owns a
 * field identity, attach the job so it shows under My jobs without a second trip.
 */
async function deliverPartyInvite(input: {
  supabase: any;
  orgId: string;
  jobId: string;
  jobTitle: string;
  userId: string;
  partyId: string;
  company: string;
  contactName: string;
  email: string | null;
  token: string;
}): Promise<{ emailed: boolean; recipientHasAccount: boolean; attachedToAccount: boolean }> {
  const email = input.email?.trim().toLowerCase() || null;
  if (!email) {
    return { emailed: false, recipientHasAccount: false, attachedToAccount: false };
  }

  const admin = createAdminClient();
  let recipientHasAccount = false;
  let erased = false;
  let attachedToAccount = false;

  if (admin) {
    const [{ data: existing }, { data: erasure }, { data: identity }] = await Promise.all([
      admin.from('profiles').select('id').ilike('email', email).limit(1).maybeSingle(),
      admin.from('network_erasures').select('email').eq('email', email).maybeSingle(),
      admin
        .from('field_identities')
        .select('id')
        .eq('channel', 'email')
        .eq('address', email)
        .maybeSingle(),
    ]);
    recipientHasAccount = Boolean(existing);
    erased = Boolean(erasure);

    // Already proved this inbox — the job lands in their list immediately.
    if (identity) {
      const { error } = await admin.from('job_party_claims').upsert(
        {
          org_id: input.orgId,
          party_id: input.partyId,
          identity_id: (identity as any).id,
        },
        { onConflict: 'party_id' },
      );
      attachedToAccount = !error;
    }
  }

  let emailed = false;
  if (!erased) {
    const [{ data: org }, inviterName] = await Promise.all([
      input.supabase.from('orgs').select('name').eq('id', input.orgId).maybeSingle(),
      actorLabelFor(input.supabase, input.userId),
    ]);
    const emailParam = encodeURIComponent(email);
    const sharePath = `/shared/${input.token}?email=${emailParam}`;
    const mail = partyInviteEmail({
      orgName: (org as any)?.name ?? 'a contractor',
      inviterName,
      jobTitle: input.jobTitle,
      recipientName: input.contactName || input.company,
      recipientEmail: email,
      recipientHasAccount,
      origin: config.frontendOrigins?.[0] ?? null,
      path: sharePath,
      signupPath: `/login?mode=signup&email=${emailParam}`,
    });
    // Atmosphere sends — not the org's connected Gmail/Microsoft.
    const result = await sendSystemMail({
      to: email,
      subject: mail.subject,
      text: mail.text,
    });
    emailed = result.ok;
  }

  return { emailed, recipientHasAccount, attachedToAccount };
}

/**
 * POST /api/operations/intake/approve
 * One approval: job file + scope + published brief + Field Capture invites.
 */
jobIntakeRouter.post('/intake/approve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase, userId } = await requireOrgContext(req);
    const input = approveSchema.parse(req.body ?? {});

    const { data: property, error: propertyError } = await supabase
      .from('crm_properties')
      .insert({
        org_id: orgId,
        address_line1: input.address,
        city: input.city ?? null,
        postal_code: input.postalCode ?? null,
      })
      .select('id')
      .single();
    if (propertyError || !property) {
      throw new HttpError(500, 'Could not save the address.', 'property_failed');
    }

    const { data: job, error: jobError } = await supabase
      .from('crm_jobs')
      .insert({
        org_id: orgId,
        title: input.title,
        work_type: input.workType,
        property_id: (property as any).id,
        claim_number: input.claimNumber || null,
        status: 'scheduled',
        created_by: userId,
      })
      .select('id, title, job_number')
      .single();
    if (jobError || !job) throw new HttpError(500, 'Could not create the job.', 'job_failed');
    const jobId = (job as any).id as string;

    await supabase.from('job_intake').insert({
      job_id: jobId,
      org_id: orgId,
      source: 'scope_document' satisfies IntakeSource,
      source_detail: { enteredFrom: 'intake_package', captureInvites: input.invitees.length },
      entered_by: userId,
    });

    const { data: brief, error: briefError } = await supabase
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
      throw new HttpError(500, 'Could not publish the brief.', 'brief_failed');
    }
    const revision = (brief as any).revision ?? 1;

    const { data: scopeRows, error: scopeError } = await supabase
      .from('job_scope_items')
      .insert(
        input.scope.map((line) => ({
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
    if (scopeError) throw new HttpError(500, 'Could not save scope lines.', 'scope_failed');

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

    for (const person of input.invitees) {
      const company = (person.company?.trim() || person.fullName).slice(0, 160);
      const contactName = person.fullName;
      const email = person.email?.trim().toLowerCase() || null;
      const external = Boolean(person.external || !person.userId);
      const { data: party, error: partyError } = await supabase
        .from('job_parties')
        .insert({
          org_id: orgId,
          job_id: jobId,
          company,
          trade: person.trade || (external ? 'subcontractor' : 'field_capture'),
          contact_name: contactName,
          email,
          role: 'subcontractor',
          invited_at: new Date().toISOString(),
          created_by: userId,
        })
        .select('id, company, access_token, email')
        .single();
      if (partyError || !party) {
        throw new HttpError(500, `Could not invite ${contactName}.`, 'party_failed');
      }
      const token = String((party as any).access_token);
      const partyId = String((party as any).id);
      const delivery = await deliverPartyInvite({
        supabase,
        orgId,
        jobId,
        jobTitle: (job as any).title,
        userId,
        partyId,
        company,
        contactName,
        email,
        token,
      });
      const emailParam = email ? `?email=${encodeURIComponent(email)}` : '';
      invites.push({
        id: partyId,
        name: company,
        email: ((party as any).email as string) ?? email,
        token,
        sharePath: `/shared/${token}${emailParam}`,
        fieldCapturePath: `/fieldcapture/index.html?token=${encodeURIComponent(token)}`,
        external,
        emailed: delivery.emailed,
        recipientHasAccount: delivery.recipientHasAccount,
        attachedToAccount: delivery.attachedToAccount,
      });
    }

    const emailedCount = invites.filter((i) => i.emailed).length;
    await recordAccess(supabase, {
      orgId,
      jobId,
      action: 'job_created',
      actorId: userId,
      actorLabel: 'Office',
      detail: `Intake approved — ${(scopeRows ?? []).length} scope lines, brief r${revision}, ${invites.length} invite(s)${emailedCount ? `, ${emailedCount} emailed` : ''}`,
    }).catch(() => undefined);

    const facts = await factsFor(supabase, jobId);
    const primary = invites[0]!;
    res.status(201).json({
      job: {
        id: jobId,
        title: (job as any).title,
        jobNumber: (job as any).job_number ?? null,
      },
      briefRevision: revision,
      scopeSaved: (scopeRows ?? []).length,
      invites,
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
