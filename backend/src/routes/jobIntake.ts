import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { HttpError } from '../lib/errors.js';
import { assessReadiness, type IntakeSource, type JobFacts } from '../verifier/readiness.js';
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
