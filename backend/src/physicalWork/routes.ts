/**
 * Phase 1 physical-work HTTP API.
 *
 * TaskEpisode is `work_episodes`. These routes are the named dataset surface
 * on top of that row plus world states, evidence, actions, outcomes, and
 * rights-gated training export.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { HttpError } from '../lib/errors.js';
import { WORK_ACTIONS } from '../episodes/actions.js';
import { loadPhysicalWorkRecord } from './ingest.js';
import { summariseEpisodes } from './metrics.js';
import { composeDataRights } from './rights/compose.js';
import { statusFromTierAndVerifications } from './verification/status.js';
import type { EpisodeForDerive } from './types.js';

export const physicalWorkRouter = Router();
physicalWorkRouter.use(requireAuth);

const ACTOR_KINDS = [
  'human',
  'crew',
  'robot',
  'autonomous',
  'human_robot',
  'machine',
  'mixed',
] as const;

const WORLD_KINDS = ['before', 'after'] as const;

const EPISODE_SELECT =
  'id, org_id, job_id, location_id, scope_item_id, estimate_id, estimate_line_id, po_line_id, intent_note, ' +
  'trade, system, assembly, task_key, ontology_version, task_label_source, party_id, performer_id, ' +
  'performer_label, performer_kind, work_date, started_at, ended_at, status, completion_note, tier, ' +
  'confidence, worker_consent, data_rights, rights_manifest_id, created_at, updated_at';

async function assertJob(supabase: any, orgId: string, jobId: string): Promise<void> {
  const { data, error } = await supabase
    .from('crm_jobs')
    .select('id')
    .eq('id', jobId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message, 'job_lookup_failed');
  if (!data) throw new HttpError(404, 'No such job in this organization.', 'job_not_found');
}

async function loadEpisode(supabase: any, orgId: string, id: string): Promise<EpisodeForDerive> {
  const { data, error } = await supabase
    .from('work_episodes')
    .select(EPISODE_SELECT)
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message, 'episode_load_failed');
  if (!data) throw new HttpError(404, 'No such task episode.', 'task_episode_not_found');
  return data as EpisodeForDerive;
}

/** GET /api/physical-work/metrics */
physicalWorkRouter.get('/metrics', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, orgId } = await requireOrgContext(req);
    const { data, error } = await supabase
      .from('work_episodes')
      .select('id, tier, data_rights, worker_consent, trade')
      .eq('org_id', orgId);
    if (error) throw new HttpError(500, error.message, 'metrics_failed');
    const ids = ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
    let worldStateEpisodeIds = new Set<string>();
    let immediateOutcomeIds = new Set<string>();
    if (ids.length > 0) {
      const [worlds, outcomes] = await Promise.all([
        supabase.from('episode_world_states').select('episode_id').in('episode_id', ids),
        supabase.from('episode_immediate_outcomes').select('episode_id').in('episode_id', ids),
      ]);
      worldStateEpisodeIds = new Set((worlds.data ?? []).map((row: { episode_id: string }) => row.episode_id));
      immediateOutcomeIds = new Set((outcomes.data ?? []).map((row: { episode_id: string }) => row.episode_id));
    }
    const summary = summariseEpisodes(data ?? [], { worldStateEpisodeIds, immediateOutcomeIds });
    res.json({
      episodes: summary.total,
      verified: summary.verifiedPhysicalWorkEpisodes,
      withOutcomes: summary.withImmediateOutcome,
      trainingAuthorized: summary.trainingEligible,
      withWorldState: summary.withWorldState,
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/physical-work/jobs/:jobId/episodes */
physicalWorkRouter.post('/jobs/:jobId/episodes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jobId = z.string().uuid().parse(req.params.jobId);
    const body = z
      .object({
        workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        intentSummary: z.string().trim().max(2000).optional(),
        actorKind: z.enum(ACTOR_KINDS).optional(),
        performerLabel: z.string().trim().max(160).optional(),
        trade: z.string().trim().max(80).optional(),
        taskKey: z.string().trim().max(80).optional(),
      })
      .parse(req.body);
    const { supabase, orgId, userId } = await requireOrgContext(req);
    await assertJob(supabase, orgId, jobId);
    const { data, error } = await supabase
      .from('work_episodes')
      .insert({
        org_id: orgId,
        job_id: jobId,
        work_date: body.workDate,
        status: 'planned',
        intent_note: body.intentSummary ?? null,
        performer_kind: body.actorKind ?? 'human',
        performer_label: body.performerLabel ?? null,
        trade: body.trade ?? null,
        task_key: body.taskKey ?? null,
        created_by: userId,
      })
      .select(EPISODE_SELECT)
      .single();
    if (error || !data) throw new HttpError(400, error?.message ?? 'Could not create episode.', 'episode_create_failed');
    res.status(201).json({ episode: data });
  } catch (err) {
    next(err);
  }
});

/** GET /api/physical-work/jobs/:jobId/episodes */
physicalWorkRouter.get('/jobs/:jobId/episodes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jobId = z.string().uuid().parse(req.params.jobId);
    const { supabase, orgId } = await requireOrgContext(req);
    await assertJob(supabase, orgId, jobId);
    const { data, error } = await supabase
      .from('work_episodes')
      .select(EPISODE_SELECT)
      .eq('org_id', orgId)
      .eq('job_id', jobId)
      .order('work_date', { ascending: false })
      .limit(200);
    if (error) throw new HttpError(500, error.message, 'episodes_failed');
    res.json({ episodes: data ?? [] });
  } catch (err) {
    next(err);
  }
});

/** GET /api/physical-work/episodes/:id */
physicalWorkRouter.get('/episodes/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const { supabase, orgId } = await requireOrgContext(req);
    const episode = await loadEpisode(supabase, orgId, id);
    const record = await loadPhysicalWorkRecord(supabase, episode);
    const { data: verifications } = await supabase
      .from('episode_verifications')
      .select('kind, result')
      .eq('episode_id', id);
    res.json({
      episode,
      record,
      verificationStatus: statusFromTierAndVerifications({
        tier: Number(episode.tier ?? 1),
        verifications: verifications ?? [],
      }),
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/physical-work/episodes/:id/actions */
physicalWorkRouter.get('/episodes/:id/actions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const { supabase, orgId } = await requireOrgContext(req);
    await loadEpisode(supabase, orgId, id);
    const { data, error } = await supabase
      .from('episode_actions')
      .select('*')
      .eq('episode_id', id)
      .order('sequence');
    if (error) throw new HttpError(500, error.message, 'actions_failed');
    res.json({ actions: data ?? [], vocabulary: WORK_ACTIONS });
  } catch (err) {
    next(err);
  }
});

/** POST /api/physical-work/episodes/:id/world-states */
physicalWorkRouter.post('/episodes/:id/world-states', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const body = z
      .object({
        kind: z.enum(WORLD_KINDS),
        proofId: z.string().uuid().nullish(),
        summary: z.string().trim().max(2000).nullish(),
        opening: z.string().trim().max(40).nullish(),
      })
      .parse(req.body);
    const { supabase, orgId } = await requireOrgContext(req);
    await loadEpisode(supabase, orgId, id);
    const { data, error } = await supabase
      .from('episode_world_states')
      .upsert(
        {
          episode_id: id,
          org_id: orgId,
          kind: body.kind,
          source_proof_id: body.proofId ?? null,
          summary: body.summary ?? null,
          opening: body.opening ?? null,
          source: 'human',
        },
        { onConflict: 'episode_id,kind' },
      )
      .select('*')
      .single();
    if (error) throw new HttpError(400, error.message, 'world_state_failed');
    res.status(201).json({ worldState: data });
  } catch (err) {
    next(err);
  }
});

/** GET /api/physical-work/episodes/:id/world-states */
physicalWorkRouter.get('/episodes/:id/world-states', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const { supabase, orgId } = await requireOrgContext(req);
    await loadEpisode(supabase, orgId, id);
    const { data, error } = await supabase.from('episode_world_states').select('*').eq('episode_id', id);
    if (error) throw new HttpError(500, error.message, 'world_states_failed');
    res.json({ worldStates: data ?? [] });
  } catch (err) {
    next(err);
  }
});

/** POST /api/physical-work/episodes/:id/evidence */
physicalWorkRouter.post('/episodes/:id/evidence', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const body = z
      .object({
        proofId: z.string().uuid().optional(),
        verificationVideoId: z.string().uuid().optional(),
        mediaObjectId: z.string().uuid().optional(),
        kind: z.enum(['video', 'photo', 'audio', 'transcript', 'document', 'note', 'frame']).optional(),
        phase: z.string().max(40).optional(),
        note: z.string().trim().max(2000).optional(),
      })
      .refine((v) => Boolean(v.proofId || v.verificationVideoId || v.mediaObjectId || v.note), {
        message: 'Evidence needs a proof, video, media object, or note.',
      })
      .parse(req.body);
    const { supabase, orgId } = await requireOrgContext(req);
    await loadEpisode(supabase, orgId, id);
    const { data, error } = await supabase
      .from('episode_evidence_assets')
      .insert({
        episode_id: id,
        org_id: orgId,
        proof_id: body.proofId ?? null,
        kind: body.kind ?? 'video',
        phase: body.phase ?? null,
      })
      .select('*')
      .single();
    if (error) throw new HttpError(400, error.message, 'evidence_failed');
    res.status(201).json({ evidence: data });
  } catch (err) {
    next(err);
  }
});

/** GET /api/physical-work/episodes/:id/evidence */
physicalWorkRouter.get('/episodes/:id/evidence', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const { supabase, orgId } = await requireOrgContext(req);
    await loadEpisode(supabase, orgId, id);
    const { data, error } = await supabase.from('episode_evidence_assets').select('*').eq('episode_id', id);
    if (error) throw new HttpError(500, error.message, 'evidence_failed');
    res.json({ evidence: data ?? [] });
  } catch (err) {
    next(err);
  }
});

/** POST /api/physical-work/episodes/:id/outcome */
physicalWorkRouter.post('/episodes/:id/outcome', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const body = z
      .object({
        kind: z.enum([
          'completed',
          'no_failure_observed',
          'leak',
          'crack',
          'electrical_fault',
          'water_intrusion',
          'mold',
          'material_failure',
          'callback',
          'warranty_claim',
          'insurance_claim',
          'customer_complaint',
          'rework_ordered',
          'litigation',
          'other',
        ]),
        qualityResult: z.enum(['unknown', 'pass', 'fail', 'inconclusive']).optional(),
        costAmount: z.number().min(0).nullish(),
        detail: z.string().trim().max(2000).nullish(),
      })
      .parse(req.body);
    const { supabase, orgId, userId } = await requireOrgContext(req);
    const episode = await loadEpisode(supabase, orgId, id);
    const daysAfter = Math.max(
      0,
      Math.round((Date.now() - Date.parse(`${episode.work_date}T12:00:00Z`)) / 86_400_000),
    );
    const kind = body.kind === 'completed' || body.kind === 'other' ? 'no_failure_observed' : body.kind;
    const { data, error } = await supabase
      .from('episode_outcomes')
      .insert({
        episode_id: id,
        org_id: orgId,
        kind,
        days_after_work: daysAfter,
        detail: body.detail ?? body.qualityResult ?? null,
        cost_amount: body.costAmount ?? null,
        recorded_by: userId,
      })
      .select('*')
      .single();
    if (error) throw new HttpError(400, error.message, 'outcome_failed');
    res.status(201).json({ outcome: data, daysAfterWork: daysAfter });
  } catch (err) {
    next(err);
  }
});

/** GET /api/physical-work/episodes/:id/outcome */
physicalWorkRouter.get('/episodes/:id/outcome', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const { supabase, orgId } = await requireOrgContext(req);
    await loadEpisode(supabase, orgId, id);
    const [later, immediate] = await Promise.all([
      supabase.from('episode_outcomes').select('*').eq('episode_id', id).order('observed_at', { ascending: false }),
      supabase.from('episode_immediate_outcomes').select('*').eq('episode_id', id).maybeSingle(),
    ]);
    res.json({
      latest: later.data?.[0] ?? null,
      outcomes: later.data ?? [],
      immediate: immediate.data ?? null,
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/physical-work/episodes/:id/annotations */
physicalWorkRouter.get('/episodes/:id/annotations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const { supabase, orgId } = await requireOrgContext(req);
    await loadEpisode(supabase, orgId, id);
    const { data, error } = await supabase
      .from('episode_annotations')
      .select('*')
      .eq('episode_id', id)
      .order('created_at');
    if (error) throw new HttpError(500, error.message, 'annotations_failed');
    res.json({ annotations: data ?? [] });
  } catch (err) {
    next(err);
  }
});

/** GET /api/physical-work/episodes/:id/training-export */
physicalWorkRouter.get(
  '/episodes/:id/training-export',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const { supabase, orgId } = await requireOrgContext(req);
      const episode = await loadEpisode(supabase, orgId, id);
      const record = await loadPhysicalWorkRecord(supabase, episode);
      let manifest = null;
      if (episode.rights_manifest_id) {
        const { data } = await supabase
          .from('rights_manifests')
          .select('training_allowed, evaluation_allowed, category, revoked_at')
          .eq('id', episode.rights_manifest_id)
          .maybeSingle();
        manifest = data
          ? {
              trainingAllowed: data.training_allowed,
              evaluationAllowed: data.evaluation_allowed,
              category: data.category,
              revokedAt: data.revoked_at,
            }
          : null;
      }
      const composed = composeDataRights({
        workDataRights: episode.data_rights,
        workerConsent: episode.worker_consent,
        manifest,
      });
      if (!composed.trainingAllowed) {
        res.status(403).json({ allowed: false, reasons: composed.reasons, record: { ...record, rights: { ...record.rights, trainingEligible: false } } });
        return;
      }
      res.json({ allowed: true, record, rights: composed });
    } catch (err) {
      next(err);
    }
  },
);
