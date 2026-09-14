/**
 * Trade playbook library API — org-scoped checklist / skill cards.
 *
 *   GET    /api/playbooks
 *   GET    /api/playbooks/:id
 *   POST   /api/playbooks
 *   POST   /api/playbooks/from-job
 *   PATCH  /api/playbooks/:id
 *   POST   /api/playbooks/:id/publish
 *   POST   /api/playbooks/:id/archive
 *   DELETE /api/playbooks/:id
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { badRequest, notFound, HttpError } from '../lib/errors.js';
import { requireOrgContext, requireGlobalAdmin } from '../lib/orgContext.js';
import { unscopedAdminOrNull } from '../lib/scopedAdmin.js';
import {
  createPlaybook,
  createPlaybookFromDraft,
  deletePlaybook,
  generatePlaybookFromAnalysis,
  getPlaybook,
  listPlaybooks,
  updatePlaybook,
  type ProofForGenerate,
} from '../playbooks/index.js';

export const playbooksRouter = Router();
playbooksRouter.use(requireAuth);

function adminOrThrow() {
  const admin = unscopedAdminOrNull();
  if (!admin) {
    throw new HttpError(503, 'Service role unavailable', 'no_admin');
  }
  return admin;
}

const stepSchema = z.object({
  title: z.string().trim().min(1).max(200),
  instruction: z.string().trim().max(4000).optional().nullable(),
  skillKey: z.string().trim().min(1).max(64).optional().nullable(),
  evidenceHint: z.string().trim().max(1000).optional().nullable(),
});

const listQuery = z.object({
  trade: z.string().trim().max(80).optional(),
  status: z.enum(['draft', 'published', 'archived', 'all']).optional(),
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

playbooksRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = await requireOrgContext(req);
    const q = listQuery.parse(req.query);
    const playbooks = await listPlaybooks(adminOrThrow(), {
      orgId: ctx.orgId,
      trade: q.trade,
      status: q.status ?? 'all',
      q: q.q,
      limit: q.limit,
    });
    res.json({ playbooks });
  } catch (err) {
    if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid query'));
    else next(err);
  }
});

const fromJobSchema = z.object({
  jobId: z.string().uuid(),
});

playbooksRouter.post('/from-job', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = await requireOrgContext(req);
    const body = fromJobSchema.parse(req.body);
    const admin = adminOrThrow();

    const { data: job, error: jobErr } = await admin
      .from('crm_jobs')
      .select('id, title, work_type, org_id')
      .eq('id', body.jobId)
      .eq('org_id', ctx.orgId)
      .maybeSingle();
    if (jobErr) throw new HttpError(500, jobErr.message, 'job_load_failed');
    if (!job) {
      next(notFound('Job not found', 'job_not_found'));
      return;
    }

    const { data: proofs, error: proofErr } = await admin
      .from('job_proofs')
      .select('id, phase, analysis_status, ai_summary, ai_findings, work_date, captured_at')
      .eq('job_id', body.jobId)
      .eq('org_id', ctx.orgId);
    if (proofErr) throw new HttpError(500, proofErr.message, 'proofs_load_failed');

    const { data: parties } = await admin
      .from('job_parties')
      .select('trade')
      .eq('job_id', body.jobId)
      .limit(8);
    const partyTrade =
      (parties ?? []).map((p: { trade?: string | null }) => p.trade).find((t: string | null | undefined) => Boolean(t)) ??
      null;

    const draft = generatePlaybookFromAnalysis({
      job: { id: job.id, title: job.title, work_type: job.work_type },
      proofs: (proofs ?? []) as ProofForGenerate[],
      partyTrade,
    });
    if (!draft) {
      next(
        badRequest(
          'This job does not have completed analysis to turn into a playbook yet.',
          'playbook_no_analysis',
        ),
      );
      return;
    }

    const playbook = await createPlaybookFromDraft(admin, {
      orgId: ctx.orgId,
      userId: ctx.userId,
      draft,
    });
    res.status(201).json({ playbook });
  } catch (err) {
    if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid body'));
    else next(err);
  }
});


playbooksRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = await requireOrgContext(req);
    const playbook = await getPlaybook(adminOrThrow(), String(req.params.id));
    if (!playbook || playbook.orgId !== ctx.orgId) {
      next(notFound('Playbook not found', 'playbook_not_found'));
      return;
    }
    res.json({ playbook });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  trade: z.string().trim().max(80).optional().nullable(),
  summary: z.string().trim().max(4000).optional().nullable(),
  steps: z.array(stepSchema).min(1).max(40),
});

playbooksRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = await requireOrgContext(req);
    const body = createSchema.parse(req.body);
    const playbook = await createPlaybook(adminOrThrow(), {
      orgId: ctx.orgId,
      userId: ctx.userId,
      title: body.title,
      trade: body.trade ?? null,
      summary: body.summary ?? null,
      sourceKind: 'manual',
      steps: body.steps.map((s) => ({
        title: s.title,
        instruction: s.instruction ?? null,
        skillKey: s.skillKey ?? null,
        evidenceHint: s.evidenceHint ?? null,
      })),
    });
    res.status(201).json({ playbook });
  } catch (err) {
    if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid body'));
    else next(err);
  }
});

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  trade: z.string().trim().max(80).optional().nullable(),
  summary: z.string().trim().max(4000).optional().nullable(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  steps: z.array(stepSchema).min(1).max(40).optional(),
});

playbooksRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = await requireOrgContext(req);
    const body = patchSchema.parse(req.body);
    const admin = adminOrThrow();
    const existing = await getPlaybook(admin, String(req.params.id));
    if (!existing || existing.orgId !== ctx.orgId) {
      next(notFound('Playbook not found', 'playbook_not_found'));
      return;
    }
    const playbook = await updatePlaybook(admin, existing.id, {
      title: body.title,
      trade: body.trade,
      summary: body.summary,
      status: body.status,
      steps: body.steps?.map((s) => ({
        title: s.title,
        instruction: s.instruction ?? null,
        skillKey: s.skillKey ?? null,
        evidenceHint: s.evidenceHint ?? null,
      })),
    });
    res.json({ playbook });
  } catch (err) {
    if (err instanceof z.ZodError) next(badRequest(err.issues[0]?.message ?? 'Invalid body'));
    else next(err);
  }
});

playbooksRouter.post('/:id/publish', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = await requireOrgContext(req);
    const admin = adminOrThrow();
    const existing = await getPlaybook(admin, String(req.params.id));
    if (!existing || existing.orgId !== ctx.orgId) {
      next(notFound('Playbook not found', 'playbook_not_found'));
      return;
    }
    const playbook = await updatePlaybook(admin, existing.id, { status: 'published' });
    res.json({ playbook });
  } catch (err) {
    next(err);
  }
});

playbooksRouter.post('/:id/archive', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = await requireOrgContext(req);
    const admin = adminOrThrow();
    const existing = await getPlaybook(admin, String(req.params.id));
    if (!existing || existing.orgId !== ctx.orgId) {
      next(notFound('Playbook not found', 'playbook_not_found'));
      return;
    }
    const playbook = await updatePlaybook(admin, existing.id, { status: 'archived' });
    res.json({ playbook });
  } catch (err) {
    next(err);
  }
});

playbooksRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = await requireGlobalAdmin(req);
    const admin = adminOrThrow();
    const existing = await getPlaybook(admin, String(req.params.id));
    if (!existing || existing.orgId !== ctx.orgId) {
      next(notFound('Playbook not found', 'playbook_not_found'));
      return;
    }
    await deletePlaybook(admin, existing.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
