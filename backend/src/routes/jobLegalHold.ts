/**
 * Office job legal-hold portal.
 *
 * The general contractor freezes a whole job file. Staff still produce the
 * vault, including clips the customer later hid.
 */
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { requireOrgContext } from '../lib/orgContext.js';
import { HttpError } from '../lib/errors.js';
import { LEGAL_HOLD_KINDS } from '../legal/types.js';
import {
  buildOfficeJobLegalPortal,
  openJobLegalHold,
  recordUserAction,
  releaseJobLegalHold,
} from '../legal/index.js';
import { recordAccess } from './proofOfWork.js';

const openSchema = z.object({
  kind: z.enum(LEGAL_HOLD_KINDS).default('preservation'),
  reason: z.string().trim().min(1).max(4000),
  caseNumber: z.string().trim().min(1).max(120).optional(),
  title: z.string().trim().min(1).max(240).optional(),
  counselName: z.string().trim().max(200).optional(),
});

const releaseSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
});

async function jobInOrg(
  supabase: { from: (table: string) => any },
  orgId: string,
  jobId: string,
): Promise<{ id: string; title: string | null; job_number: number | null }> {
  const { data, error } = await supabase
    .from('crm_jobs')
    .select('id, title, job_number')
    .eq('id', jobId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message, 'job_lookup_failed');
  if (!data) throw new HttpError(404, 'Job not found', 'job_not_found');
  return data as { id: string; title: string | null; job_number: number | null };
}

/** GET /api/operations/shared/:jobId/legal-hold */
export async function getJobLegalHold(req: Request, res: Response, next: NextFunction) {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const job = await jobInOrg(supabase, orgId, req.params.jobId);
    const { data, error } = await supabase
      .from('job_evidence_items')
      .select('id, title, work_date, phase, party_company, legal_hold, content_hash, duration_seconds, byte_size, received_at')
      .eq('org_id', orgId)
      .eq('job_id', req.params.jobId)
      .order('work_date', { ascending: false });
    if (error) throw new HttpError(500, error.message, 'legal_hold_portal_failed');

    const portal = await buildOfficeJobLegalPortal({
      orgId,
      jobId: job.id,
      jobTitle: job.title,
      jobNumber: job.job_number,
      clips: ((data ?? []) as any[]).map((row) => ({
        id: row.id,
        title: row.title,
        workDate: row.work_date,
        phase: row.phase,
        company: row.party_company,
        legalHold: row.legal_hold,
        contentHash: row.content_hash,
        durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
        byteSize: row.byte_size == null ? null : Number(row.byte_size),
        receivedAt: row.received_at,
      })),
    });
    res.json(portal);
  } catch (err) {
    next(err);
  }
}

/** POST /api/operations/shared/:jobId/legal-hold */
export async function setJobLegalHold(req: Request, res: Response, next: NextFunction) {
  try {
    const { orgId, userId, supabase } = await requireOrgContext(req);
    const job = await jobInOrg(supabase, orgId, req.params.jobId);
    const input = openSchema.parse(req.body ?? {});
    const hold = await openJobLegalHold({
      orgId,
      jobId: job.id,
      jobTitle: job.title,
      kind: input.kind,
      reason: input.reason,
      caseNumber: input.caseNumber ?? null,
      title: input.title ?? null,
      counselName: input.counselName ?? null,
      createdBy: userId,
    });
    const actor = await actorLabel(supabase, userId);
    await recordAccess(supabase, {
      orgId,
      jobId: job.id,
      action: 'held',
      detail: input.reason,
      actorId: userId,
      actorLabel: actor,
      actorRole: 'general_contractor',
    });
    await recordUserAction({
      actorUserId: userId,
      actorLabel: actor,
      orgId,
      action: 'legal.job_hold_opened',
      resourceType: 'job',
      resourceId: job.id,
      detail: { holdId: hold.id, kind: hold.kind, caseNumber: hold.caseNumber },
    });
    res.status(201).json({ hold });
  } catch (err) {
    if (err instanceof z.ZodError) {
      next(new HttpError(400, err.issues[0]?.message ?? 'Invalid hold', 'bad_request'));
    } else next(err);
  }
}

/** POST /api/operations/shared/:jobId/legal-hold/release */
export async function releaseJobHold(req: Request, res: Response, next: NextFunction) {
  try {
    const { orgId, userId, supabase } = await requireOrgContext(req);
    const job = await jobInOrg(supabase, orgId, req.params.jobId);
    const input = releaseSchema.parse(req.body ?? {});
    const hold = await releaseJobLegalHold(job.id, { releasedBy: userId, reason: input.reason });
    const actor = await actorLabel(supabase, userId);
    await recordAccess(supabase, {
      orgId,
      jobId: job.id,
      action: 'released',
      detail: input.reason,
      actorId: userId,
      actorLabel: actor,
      actorRole: 'general_contractor',
    });
    await recordUserAction({
      actorUserId: userId,
      actorLabel: actor,
      orgId,
      action: 'legal.job_hold_released',
      resourceType: 'job',
      resourceId: job.id,
      detail: { holdId: hold.id },
    });
    res.json({ hold });
  } catch (err) {
    if (err instanceof z.ZodError) {
      next(new HttpError(400, err.issues[0]?.message ?? 'Invalid release', 'bad_request'));
    } else next(err);
  }
}

async function actorLabel(supabase: { from: (table: string) => any }, userId: string): Promise<string> {
  const { data } = await supabase.from('profiles').select('full_name, email').eq('id', userId).maybeSingle();
  return (data as any)?.full_name ?? (data as any)?.email ?? 'Office';
}
