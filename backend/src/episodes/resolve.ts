import { assessEpisode, emptyFacts, type EpisodeAssessment, type EpisodeFacts } from './tiers.js';
import { taskByKey } from './ontology.js';

/**
 * From rows to a judgement.
 *
 * The tier engine is pure and knows nothing about Postgres; this is the seam
 * that feeds it. Everything here is mechanical translation with one piece of
 * real judgement in it: the mapping from what the shipped proof flow already
 * records onto the observation phases the episode model expects.
 *
 * A `before` video is a capture of the existing condition. An `after` video is
 * a capture of the completed state — which is a claim about the day's work,
 * not about the task being finished, and the tier engine is careful never to
 * read it as more than that.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const LOCATION_DEPTH: Record<string, EpisodeFacts['locationDepth']> = {
  site: 'job',
  building: 'building',
  floor: 'building',
  zone: 'room',
  room: 'room',
  surface: 'surface',
  assembly: 'assembly',
};

/** Proof phases, as the shipped capture flow records them. */
const PHASE_FROM_PROOF: Record<string, EpisodeFacts['observations'][number]['phase']> = {
  before: 'existing_condition',
  after: 'complete',
};

export interface EpisodeRows {
  episode: any;
  location?: any | null;
  observations?: any[];
  /** job_proofs rows referenced by those observations, keyed by id. */
  proofs?: Map<string, any>;
  actions?: any[];
  resources?: any[];
  verifications?: any[];
  outcomes?: any[];
  economics?: any | null;
}

export function factsFromRows(rows: EpisodeRows): EpisodeFacts {
  const e = rows.episode;
  const facts = emptyFacts();

  facts.taskKey = e.task_key ?? null;
  facts.taskLabelSource = e.task_label_source ?? 'ai';
  facts.taskMaturity = e.task_key ? (taskByKey(e.task_key)?.maturity ?? null) : null;

  facts.hasIntent = Boolean(e.scope_item_id || e.estimate_line_id || e.po_line_id || e.intent_note);
  facts.performerKind = e.performer_kind ?? 'human';
  facts.performerNamed = Boolean(e.performer_id || e.performer_label);
  facts.partyAttributed = Boolean(e.party_id);
  facts.workerConsent = e.worker_consent ?? 'not_asked';

  facts.locationDepth = rows.location ? (LOCATION_DEPTH[rows.location.kind] ?? 'job') : 'none';
  facts.hasModelElement = Boolean(rows.location?.model_element_id);

  facts.hasWorkDate = Boolean(e.work_date);
  facts.hasStartEnd = Boolean(e.started_at && e.ended_at);

  // Observations, plus the proof rows behind them. The verifier's findings
  // live on the proof, so they are counted here rather than duplicated.
  for (const observation of rows.observations ?? []) {
    const proof = observation.proof_id ? rows.proofs?.get(observation.proof_id) : null;
    facts.observations.push({
      phase: observation.phase,
      evidenceKind: observation.evidence_kind ?? 'video',
      hasMedia: Boolean(observation.proof_id),
      hasReading: observation.reading_value !== null && observation.reading_value !== undefined,
    });

    for (const check of (proof?.checks ?? []) as Array<{ verdict?: string }>) {
      if (check.verdict === 'pass') facts.proofChecks.passed += 1;
      else if (check.verdict === 'fail') facts.proofChecks.failed += 1;
      else facts.proofChecks.unknown += 1;
    }
    if (proof?.lat !== null && proof?.lat !== undefined) facts.hasGeotaggedMedia = true;
  }

  for (const action of rows.actions ?? []) {
    facts.actions.push({
      labelSource: action.label_source ?? 'ai',
      confidence: action.confidence === null || action.confidence === undefined ? null : Number(action.confidence),
      validated: Boolean(action.validated_at),
      hasTiming: Boolean(action.started_at || action.start_seconds !== null),
      hasTool: Boolean(action.tool_label),
      hasMaterial: Boolean(action.material_label || action.po_line_id),
    });
  }

  for (const resource of rows.resources ?? []) {
    facts.resources.push({
      kind: resource.kind,
      source: resource.source ?? 'human',
      hasSettings: Boolean(resource.settings && Object.keys(resource.settings).length > 0),
      hasLotOrSku: Boolean(resource.lot_number || resource.model_or_sku),
    });
  }

  for (const verification of rows.verifications ?? []) {
    facts.verifications.push({
      kind: verification.kind,
      result: verification.result,
      hasMeasurement:
        verification.measurement_value !== null && verification.measurement_value !== undefined,
    });
  }

  for (const outcome of rows.outcomes ?? []) {
    facts.outcomes.push({
      kind: outcome.kind,
      daysAfterWork: outcome.days_after_work ?? null,
      corrected: Boolean(outcome.corrected_by_episode_id),
    });
  }

  if (rows.economics) {
    facts.economics = {
      present: true,
      hasCosts: [rows.economics.labor_cost, rows.economics.material_cost, rows.economics.equipment_cost].some(
        (v) => v !== null && v !== undefined,
      ),
      hasSettlement: [rows.economics.approved_amount, rows.economics.insurance_paid_amount].some(
        (v) => v !== null && v !== undefined,
      ),
    };
  }

  return facts;
}

export function assessRows(rows: EpisodeRows): EpisodeAssessment {
  return assessEpisode(factsFromRows(rows));
}

/**
 * The observation phase a proof upload becomes.
 *
 * Exported rather than inlined because the capture flow will grow phases the
 * proof table does not have yet — a pre-conceal capture is a different act
 * from an end-of-day after video, and when the UI can express that, this is
 * the one place that has to learn about it.
 */
export function observationPhaseForProof(proofPhase: string): EpisodeFacts['observations'][number]['phase'] {
  return PHASE_FROM_PROOF[proofPhase] ?? 'in_progress';
}
