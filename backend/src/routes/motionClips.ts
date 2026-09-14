/**
 * Motion clips browse API — Internal / Jettx staff only.
 *
 *   GET /api/motion-clips                 staff corpus (org-scoped when caller has org)
 *   GET /api/motion-clips/types           known narrow motion labels
 *   GET /api/motion-clips/staff           cross-org staff browse
 *   GET /api/motion-clips/job/:jobId      job-scoped clips for Internal tooling
 *
 * Not on the customer job file. Homeowners, guests, invitees, and ordinary
 * org Platform users must not browse the robotics skill corpus here —
 * generation still runs on proofs; Internal `/motion-clips` is the UI.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAnalytics } from '../middleware/requireAnalytics.js';
import { badRequest, notFound } from '../lib/errors.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { unscopedAdminOrNull } from '../lib/scopedAdmin.js';
import { HttpError } from '../lib/errors.js';
import {
  bucketMotionClipsByType,
  listKnownMotionTypes,
  motionClipsFromProofRow,
  type MotionClipBrowseItem,
} from '../shared/motionClips.js';

export const motionClipsRouter = Router();

motionClipsRouter.use(requireAuth);
motionClipsRouter.use(requireAnalytics('internal'));

function adminOrThrow() {
  const admin = unscopedAdminOrNull();
  if (!admin) {
    throw Object.assign(new Error('Service role unavailable'), {
      status: 503,
      code: 'no_admin',
    });
  }
  return admin;
}

const browseQuery = z.object({
  motion: z.string().trim().min(1).max(40).optional(),
  jobId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

function clipsFromProofRows(
  rows: any[],
  meta: { orgId: string; jobTitleById?: Map<string, string | null>; companyByParty?: Map<string, string | null> },
): MotionClipBrowseItem[] {
  const out: MotionClipBrowseItem[] = [];
  for (const row of rows) {
    const stored = motionClipsFromProofRow(row);
    if (!stored?.clips.length) continue;
    const jobId = String(row.job_id);
    for (const clip of stored.clips) {
      out.push({
        ...clip,
        proofId: String(row.id),
        jobId,
        orgId: meta.orgId || String(row.org_id ?? ''),
        workDate: row.work_date ?? null,
        phase: row.phase ?? null,
        jobTitle: meta.jobTitleById?.get(jobId) ?? null,
        company: meta.companyByParty?.get(row.party_id) ?? null,
      });
    }
  }
  return out;
}

motionClipsRouter.get(
  '/types',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({
        types: listKnownMotionTypes(),
        note: 'Narrow labels (screw, cut, measure, …) are only emitted when evidence supports them. Atmosphere never invents motions.',
      });
    } catch (err) {
      next(err);
    }
  },
);

motionClipsRouter.get(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = await requireOrgContext(req);
      const q = browseQuery.parse(req.query);
      const admin = adminOrThrow();
      let query = admin
        .from('job_proofs')
        .select('id, org_id, job_id, party_id, work_date, phase, actions, ai_findings, deleted_at')
        .eq('org_id', ctx.orgId)
        .is('deleted_at', null)
        .order('captured_at', { ascending: false })
        .limit(q.limit ?? 120);
      if (q.jobId) query = query.eq('job_id', q.jobId);
      const { data, error } = await query;
      if (error) throw new HttpError(500, error.message, 'motion_clips_lookup_failed');

      const rows = (data ?? []) as any[];
      const jobIds = [...new Set(rows.map((r) => r.job_id).filter(Boolean))];
      const jobTitleById = new Map<string, string | null>();
      if (jobIds.length) {
        const { data: jobs } = await admin
          .from('crm_jobs')
          .select('id, title')
          .eq('org_id', ctx.orgId)
          .in('id', jobIds);
        for (const j of (jobs ?? []) as any[]) {
          jobTitleById.set(j.id, j.title ?? null);
        }
      }

      const items = clipsFromProofRows(rows, { orgId: ctx.orgId, jobTitleById });
      const buckets = bucketMotionClipsByType(items, { motion: q.motion ?? null });
      res.json({
        orgId: ctx.orgId,
        motion: q.motion ?? null,
        totalClips: items.filter((c) =>
          q.motion
            ? c.motion === q.motion.toLowerCase() || c.action === q.motion.toLowerCase()
            : true,
        ).length,
        types: buckets.map((b) => ({ motion: b.motion, action: b.action, count: b.count })),
        buckets,
        disclaimer:
          'Clips are labelled only from verified proof evidence. Privacy ranges are excluded. Empty means not evidenced — never invented.',
      });
    } catch (err) {
      if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid query'));
      else next(err);
    }
  },
);

motionClipsRouter.get(
  '/job/:jobId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = await requireOrgContext(req);
      const jobId = String(req.params.jobId);
      const q = browseQuery.omit({ jobId: true }).parse(req.query);
      const admin = adminOrThrow();

      const { data: job, error: jobErr } = await admin
        .from('crm_jobs')
        .select('id, title, deleted_at')
        .eq('org_id', ctx.orgId)
        .eq('id', jobId)
        .maybeSingle();
      if (jobErr) throw new HttpError(500, jobErr.message, 'job_lookup_failed');
      if (!job || (job as any).deleted_at) {
        next(notFound('No such job.', 'job_not_found'));
        return;
      }

      const { data, error } = await admin
        .from('job_proofs')
        .select('id, org_id, job_id, party_id, work_date, phase, actions, ai_findings, deleted_at')
        .eq('org_id', ctx.orgId)
        .eq('job_id', jobId)
        .is('deleted_at', null)
        .order('work_date', { ascending: true })
        .limit(200);
      if (error) throw new HttpError(500, error.message, 'motion_clips_lookup_failed');

      const items = clipsFromProofRows((data ?? []) as any[], {
        orgId: ctx.orgId,
        jobTitleById: new Map([[jobId, (job as any).title ?? null]]),
      });
      const buckets = bucketMotionClipsByType(items, { motion: q.motion ?? null });
      res.json({
        jobId,
        jobTitle: (job as any).title ?? null,
        motion: q.motion ?? null,
        totalClips: items.length,
        types: buckets.map((b) => ({ motion: b.motion, action: b.action, count: b.count })),
        buckets,
        clips: q.motion
          ? items.filter(
              (c) =>
                c.motion === q.motion!.toLowerCase() || c.action === q.motion!.toLowerCase(),
            )
          : items,
        disclaimer:
          'Clips are labelled only from verified proof evidence. Privacy ranges are excluded. Empty means not evidenced — never invented.',
      });
    } catch (err) {
      if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid query'));
      else next(err);
    }
  },
);

motionClipsRouter.get(
  '/staff',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = browseQuery.extend({
        orgId: z.string().uuid().optional(),
      }).parse(req.query);
      const admin = adminOrThrow();
      let query = admin
        .from('job_proofs')
        .select('id, org_id, job_id, party_id, work_date, phase, actions, ai_findings, deleted_at')
        .is('deleted_at', null)
        .order('captured_at', { ascending: false })
        .limit(q.limit ?? 150);
      if (q.orgId) query = query.eq('org_id', q.orgId);
      if (q.jobId) query = query.eq('job_id', q.jobId);
      const { data, error } = await query;
      if (error) throw new HttpError(500, error.message, 'motion_clips_staff_lookup_failed');

      const rows = (data ?? []) as any[];
      const items: MotionClipBrowseItem[] = [];
      for (const row of rows) {
        const stored = motionClipsFromProofRow(row);
        if (!stored?.clips.length) continue;
        for (const clip of stored.clips) {
          items.push({
            ...clip,
            proofId: String(row.id),
            jobId: String(row.job_id),
            orgId: String(row.org_id),
            workDate: row.work_date ?? null,
            phase: row.phase ?? null,
          });
        }
      }
      const buckets = bucketMotionClipsByType(items, { motion: q.motion ?? null, limitPerType: 30 });
      res.json({
        motion: q.motion ?? null,
        orgId: q.orgId ?? null,
        totalClips: items.length,
        types: buckets.map((b) => ({ motion: b.motion, action: b.action, count: b.count })),
        buckets,
        knownTypes: listKnownMotionTypes(),
        disclaimer:
          'Staff corpus browse. Clips only from verified proof evidence; privacy ranges excluded; never invented.',
      });
    } catch (err) {
      if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid query'));
      else next(err);
    }
  },
);
