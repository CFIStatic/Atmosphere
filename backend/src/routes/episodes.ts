import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { HttpError } from '../lib/errors.js';
import { assessRows, factsFromRows } from '../episodes/resolve.js';
import { ONTOLOGY_VERSION, capturePlan, ontologyTree, taskByKey } from '../episodes/ontology.js';
import { ACTION_DEFINITIONS, WORK_ACTIONS } from '../episodes/actions.js';

/**
 * Work episodes over HTTP.
 *
 * The read side is generous — an episode is only useful if a person can see
 * what it is missing — and the write side is narrow. Two things are writable
 * here and both are additive: a verification result and a later outcome.
 * Everything else about an episode is derived from work that happened
 * elsewhere, and a route that let somebody set `tier` directly would make
 * every score meaningless.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const episodesRouter = Router();
episodesRouter.use(requireAuth);

const EPISODE_SELECT =
  'id, job_id, location_id, scope_item_id, estimate_id, estimate_line_id, po_line_id, intent_note, ' +
  'trade, system, assembly, task_key, ontology_version, task_label_source, party_id, performer_id, ' +
  'performer_label, performer_kind, work_date, started_at, ended_at, status, completion_note, tier, ' +
  'confidence, worker_consent, data_rights, created_at, updated_at';

/** Everything hanging off one episode, loaded together. */
async function loadEpisode(supabase: any, id: string) {
  const { data: episode, error } = await supabase
    .from('work_episodes')
    .select(EPISODE_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message, 'episode_load_failed');
  if (!episode) throw new HttpError(404, 'No such work episode.', 'episode_not_found');

  const [location, observations, actions, resources, verifications, outcomes, economics] =
    await Promise.all([
      episode.location_id
        ? supabase.from('job_locations').select('*').eq('id', episode.location_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from('episode_observations').select('*').eq('episode_id', id).order('observed_at'),
      supabase.from('episode_actions').select('*').eq('episode_id', id).order('sequence'),
      supabase.from('episode_resources').select('*').eq('episode_id', id),
      supabase.from('episode_verifications').select('*').eq('episode_id', id).order('verified_at'),
      supabase.from('episode_outcomes').select('*').eq('episode_id', id).order('observed_at'),
      supabase.from('episode_economics').select('*').eq('episode_id', id).maybeSingle(),
    ]);

  // The verifier's findings live on the proof rows, so they come along.
  const proofIds = (observations.data ?? [])
    .map((o: any) => o.proof_id)
    .filter((v: string | null): v is string => Boolean(v));
  const proofs = new Map<string, any>();
  if (proofIds.length > 0) {
    const { data } = await supabase
      .from('job_proofs')
      .select('id, phase, work_date, checks, lat, lon, captured_at, duration_seconds, ai_summary')
      .in('id', proofIds);
    for (const proof of data ?? []) proofs.set(proof.id, proof);
  }

  return {
    episode,
    location: location.data,
    observations: observations.data ?? [],
    proofs,
    actions: actions.data ?? [],
    resources: resources.data ?? [],
    verifications: verifications.data ?? [],
    outcomes: outcomes.data ?? [],
    economics: economics.data,
  };
}

/**
 * Recompute and store the assessment.
 *
 * Stored rather than computed on read so the record shows what was known when
 * a decision was taken — the same reason the proof verifier's findings are
 * written back rather than re-derived.
 */
async function restore(supabase: any, id: string) {
  const rows = await loadEpisode(supabase, id);
  const assessment = assessRows(rows);
  await supabase
    .from('work_episodes')
    .update({ tier: assessment.tier, confidence: assessment.confidence })
    .eq('id', id);
  return { rows, assessment };
}

/** GET /api/episodes/ontology — the task tree and the action vocabulary. */
episodesRouter.get('/ontology', (_req: Request, res: Response) => {
  res.json({
    version: ONTOLOGY_VERSION,
    trades: ontologyTree(),
    actions: WORK_ACTIONS.map((action) => ({ action, ...ACTION_DEFINITIONS[action] })),
  });
});

/** GET /api/episodes/tasks/:key — one task definition, plus its capture plan. */
episodesRouter.get('/tasks/:key', (req: Request, res: Response, next: NextFunction) => {
  try {
    const task = taskByKey(req.params.key);
    if (!task) throw new HttpError(404, 'No such task in the ontology.', 'task_not_found');
    res.json({ task, capturePlan: capturePlan(task) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/episodes?jobId= — the list, with tier and the weakest dimension. */
episodesRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId, minTier } = z
      .object({ jobId: z.string().uuid().optional(), minTier: z.coerce.number().min(1).max(5).optional() })
      .parse(req.query);
    const { supabase, orgId } = await requireOrgContext(req);

    let query = supabase
      .from('work_episodes')
      .select(EPISODE_SELECT)
      .eq('org_id', orgId)
      .order('work_date', { ascending: false })
      .limit(200);
    if (jobId) query = query.eq('job_id', jobId);
    if (minTier) query = query.gte('tier', minTier);

    const { data, error } = await query;
    if (error) throw new HttpError(500, error.message, 'episodes_failed');

    res.json({
      episodes: (data ?? []).map((row: any) => ({
        id: row.id,
        jobId: row.job_id,
        taskKey: row.task_key,
        taskName: row.task_key ? (taskByKey(row.task_key)?.name ?? row.task_key) : null,
        trade: row.trade,
        workDate: row.work_date,
        status: row.status,
        tier: row.tier,
        confidence: row.confidence,
        dataRights: row.data_rights,
        performerLabel: row.performer_label,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/episodes/:id — the whole episode, freshly assessed. */
episodesRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase } = await requireOrgContext(req);
    const { rows, assessment } = await restore(supabase, req.params.id);
    const task = rows.episode.task_key ? taskByKey(rows.episode.task_key) : null;

    res.json({
      episode: rows.episode,
      task,
      capturePlan: task ? capturePlan(task) : [],
      location: rows.location,
      observations: rows.observations,
      actions: rows.actions,
      resources: rows.resources,
      verifications: rows.verifications,
      outcomes: rows.outcomes,
      economics: rows.economics,
      assessment,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/episodes/:id/verifications
 *
 * Ground truth. Append-only at the database level, so this route cannot
 * overwrite an earlier result even by accident — a second opinion is a second
 * row, and an inspector overruling a model is the most valuable pair of rows
 * in the schema.
 */
episodesRouter.post('/:id/verifications', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z
      .object({
        kind: z.enum([
          'gc_acceptance',
          'owner_acceptance',
          'code_inspection',
          'engineer_review',
          'pressure_test',
          'electrical_test',
          'moisture_reading',
          'thermal_scan',
          'punch_list',
          'third_party_test',
        ]),
        result: z.enum(['pass', 'fail', 'inconclusive']),
        verifierLabel: z.string().max(200).nullish(),
        measurementName: z.string().max(80).nullish(),
        measurementValue: z.number().nullish(),
        measurementUnit: z.string().max(20).nullish(),
        toleranceNote: z.string().max(500).nullish(),
        detail: z.string().max(2000).nullish(),
      })
      .parse(req.body);
    const { supabase, orgId, userId } = await requireOrgContext(req);

    const { error } = await supabase.from('episode_verifications').insert({
      episode_id: req.params.id,
      org_id: orgId,
      kind: body.kind,
      result: body.result,
      verifier_label: body.verifierLabel ?? null,
      verified_by: userId,
      measurement_name: body.measurementName ?? null,
      measurement_value: body.measurementValue ?? null,
      measurement_unit: body.measurementUnit ?? null,
      tolerance_note: body.toleranceNote ?? null,
      detail: body.detail ?? null,
    });
    if (error) throw new HttpError(400, error.message, 'verification_failed');

    // A failed verification is a statement about the work, so the episode's
    // own status follows it rather than waiting for somebody to notice.
    if (body.result === 'fail') {
      await supabase.from('work_episodes').update({ status: 'failed' }).eq('id', req.params.id);
    }

    const { assessment } = await restore(supabase, req.params.id);
    res.status(201).json({ assessment });
  } catch (err) {
    next(err);
  }
});

/** POST /api/episodes/:id/outcomes — what happened later, including nothing. */
episodesRouter.post('/:id/outcomes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z
      .object({
        kind: z.enum([
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
        ]),
        detail: z.string().max(2000).nullish(),
        costAmount: z.number().min(0).nullish(),
        responsiblePartyId: z.string().uuid().nullish(),
        correctedByEpisodeId: z.string().uuid().nullish(),
      })
      .parse(req.body);
    const { supabase, orgId, userId } = await requireOrgContext(req);

    const { data: episode } = await supabase
      .from('work_episodes')
      .select('work_date')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!episode) throw new HttpError(404, 'No such work episode.', 'episode_not_found');

    // Computed here rather than left to the caller: "how long did it hold" is
    // the entire value of this row, and a client that omits it silently
    // destroys the only durability signal in the dataset.
    const daysAfter = Math.max(
      0,
      Math.round((Date.now() - Date.parse(`${episode.work_date}T12:00:00Z`)) / 86_400_000),
    );

    const { error } = await supabase.from('episode_outcomes').insert({
      episode_id: req.params.id,
      org_id: orgId,
      kind: body.kind,
      days_after_work: daysAfter,
      detail: body.detail ?? null,
      cost_amount: body.costAmount ?? null,
      responsible_party_id: body.responsiblePartyId ?? null,
      corrected_by_episode_id: body.correctedByEpisodeId ?? null,
      recorded_by: userId,
    });
    if (error) throw new HttpError(400, error.message, 'outcome_failed');

    const { assessment } = await restore(supabase, req.params.id);
    res.status(201).json({ assessment, daysAfterWork: daysAfter });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/episodes/dataset/summary
 *
 * What the org has, by tier and by rights. The shape a licensing conversation
 * actually needs — and it counts only what the org is permitted to offer,
 * because a total that includes episodes nobody consented to is a number that
 * cannot be sold.
 */
episodesRouter.get('/dataset/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, orgId } = await requireOrgContext(req);
    const { data, error } = await supabase
      .from('work_episodes')
      .select('tier, data_rights, worker_consent, trade, task_key')
      .eq('org_id', orgId);
    if (error) throw new HttpError(500, error.message, 'summary_failed');

    const byTier: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const byTrade: Record<string, number> = {};
    let licensable = 0;
    let consentPending = 0;

    for (const row of (data ?? []) as any[]) {
      byTier[row.tier] = (byTier[row.tier] ?? 0) + 1;
      if (row.trade) byTrade[row.trade] = (byTrade[row.trade] ?? 0) + 1;
      if (row.data_rights === 'licensable') licensable += 1;
      else if (row.worker_consent === 'not_asked') consentPending += 1;
    }

    res.json({
      total: data?.length ?? 0,
      byTier,
      byTrade,
      licensable,
      // Named as a gap rather than a figure: these are episodes that could be
      // offered if somebody asked the people in them, and have not been asked.
      consentPending,
    });
  } catch (err) {
    next(err);
  }
});

export { factsFromRows };
