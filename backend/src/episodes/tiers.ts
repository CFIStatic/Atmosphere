/**
 * How good is this episode, and what would make it better.
 *
 * Two outputs, both of them deliberately unflattering by default.
 *
 * **Tier** is what the episode is worth as data, on a ladder that has to be
 * climbed rather than jumped: an episode cannot be Tier 3 while failing a
 * Tier 2 requirement, however much depth data it carries. Alongside the tier
 * comes the list of what is missing from the next rung, because a score with
 * no next action is a vanity metric — the point is to tell a crew "film the
 * cavity before the board goes up and this becomes Tier 3."
 *
 * **Confidence** is scored per dimension, not once. Episodes are almost never
 * uniformly good: the time may be provable to the second while the material is
 * a guess from a video frame. A buyer training on this needs to select on the
 * dimension they care about, and a PM deciding whether to pay needs to know
 * which part of the record is soft.
 *
 * ## The two rules everything else follows from
 *
 * **A model's opinion is not ground truth.** `ai_analysis` is a verification
 * kind, and it deliberately does not count toward the completion or quality
 * dimensions, and cannot lift an episode past Tier 2. A dataset that cannot
 * distinguish "the model thought it looked done" from "the inspector passed
 * it" teaches activity, not quality — and activity is the cheap half.
 *
 * **Unknown is not pass.** An inconclusive test, an unreviewed label, an
 * absent outcome: all of them score low rather than neutral. The failure mode
 * this guards against is the expensive one — an episode that looks strong
 * because nobody checked it.
 */

export type Tier = 1 | 2 | 3 | 4 | 5;

export type ConfidenceDimension =
  | 'identity'
  | 'location'
  | 'time'
  | 'task_classification'
  | 'action_labeling'
  | 'material_identification'
  | 'completion'
  | 'quality'
  | 'responsibility'
  | 'outcome';

export interface DimensionScore {
  /** 0–1. Rounded to two places; these are estimates, not measurements. */
  score: number;
  /** Why it is what it is, in one line a person can argue with. */
  basis: string;
}

export interface EpisodeAssessment {
  tier: Tier;
  /** What the next rung needs. Empty at Tier 5. */
  missingForNextTier: string[];
  confidence: Record<ConfidenceDimension, DimensionScore>;
  /** The lowest dimension, which is usually the one worth acting on. */
  weakest: ConfidenceDimension;
}

/* ------------------------------------------------------------------ *
 * Input — a flat description of what the episode actually has.
 * The caller assembles this from rows; this module never touches a database,
 * which is what makes every rule here testable in a millisecond.
 * ------------------------------------------------------------------ */

export type ObservationPhase =
  | 'existing_condition'
  | 'in_progress'
  | 'pre_conceal'
  | 'complete'
  | 'verification'
  | 'failure'
  | 'rework';

export interface ObservationFacts {
  phase: ObservationPhase;
  evidenceKind: 'video' | 'photo' | 'audio' | 'depth_scan' | 'measurement' | 'sensor' | 'document' | 'note';
  hasMedia: boolean;
  /** A structured reading rather than a picture of one. */
  hasReading: boolean;
}

export interface ActionFacts {
  labelSource: 'ai' | 'human' | 'tool';
  confidence: number | null;
  validated: boolean;
  hasTiming: boolean;
  hasTool: boolean;
  hasMaterial: boolean;
}

export interface ResourceFacts {
  kind: 'tool' | 'material';
  source: 'human' | 'ai' | 'purchase_order' | 'telemetry';
  hasSettings: boolean;
  hasLotOrSku: boolean;
}

export interface VerificationFacts {
  kind:
    | 'ai_analysis'
    | 'gc_acceptance'
    | 'owner_acceptance'
    | 'code_inspection'
    | 'engineer_review'
    | 'pressure_test'
    | 'electrical_test'
    | 'moisture_reading'
    | 'thermal_scan'
    | 'punch_list'
    | 'third_party_test';
  result: 'pass' | 'fail' | 'inconclusive';
  hasMeasurement: boolean;
}

export interface OutcomeFacts {
  kind: string;
  daysAfterWork: number | null;
  /** For a failure, whether a correcting episode is linked. */
  corrected: boolean;
}

export interface EpisodeFacts {
  taskKey: string | null;
  taskLabelSource: 'ai' | 'human' | 'rule';
  /** A stub ontology entry classifies an episode less reliably than a seeded one. */
  taskMaturity: 'seeded' | 'stub' | null;

  hasIntent: boolean;
  performerKind: 'human' | 'machine' | 'mixed';
  /** A named account, not just a company. */
  performerNamed: boolean;
  partyAttributed: boolean;
  workerConsent: 'granted' | 'declined' | 'not_asked';

  /** How far down the location tree this episode is pinned. */
  locationDepth: 'none' | 'job' | 'building' | 'room' | 'surface' | 'assembly';
  hasModelElement: boolean;

  hasWorkDate: boolean;
  hasStartEnd: boolean;
  /**
   * The proof verifier's findings on this episode's media, reduced to counts.
   * `unknown` is carried separately from `failed` on purpose: they mean
   * different things and only one of them is an accusation.
   */
  proofChecks: { passed: number; failed: number; unknown: number };
  hasGeotaggedMedia: boolean;

  observations: ObservationFacts[];
  actions: ActionFacts[];
  resources: ResourceFacts[];
  verifications: VerificationFacts[];
  outcomes: OutcomeFacts[];

  economics: { present: boolean; hasCosts: boolean; hasSettlement: boolean };

  /** Tier 4 territory: rig quality, not job quality. */
  calibration: {
    calibratedCameras: boolean;
    preciseGeometry: boolean;
    objectPoses: boolean;
    forceOrTorqueData: boolean;
  };

  /** Tier 5 territory. Absent for every episode a person performed alone. */
  robot: {
    attempted: boolean;
    controlsRecorded: boolean;
    humanIntervened: boolean;
    correctedBehaviourRecorded: boolean;
  };
}

/** Ground truth is any verification that is not a model reading its own frames. */
const GROUND_TRUTH_KINDS = new Set<VerificationFacts['kind']>([
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
]);

/** Instrument results, which say something a signature does not. */
const INSTRUMENT_KINDS = new Set<VerificationFacts['kind']>([
  'pressure_test',
  'electrical_test',
  'moisture_reading',
  'thermal_scan',
  'third_party_test',
]);

const LOCATION_SCORE: Record<EpisodeFacts['locationDepth'], number> = {
  none: 0,
  job: 0.2,
  building: 0.35,
  room: 0.65,
  surface: 0.85,
  assembly: 0.95,
};

const round2 = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;

const has = (facts: EpisodeFacts, phase: ObservationPhase) =>
  facts.observations.some((o) => o.phase === phase && (o.hasMedia || o.hasReading));

function groundTruth(facts: EpisodeFacts): VerificationFacts[] {
  return facts.verifications.filter((v) => GROUND_TRUTH_KINDS.has(v.kind));
}

/* ------------------------------------------------------------------ *
 * Tiers
 * ------------------------------------------------------------------ */

/**
 * Each rung states its own requirements as named checks, so the tier and the
 * "what is missing" list are computed from one source instead of two lists
 * that drift apart.
 */
function rungRequirements(facts: EpisodeFacts): Array<Array<{ label: string; met: boolean }>> {
  const gt = groundTruth(facts);
  const validatedActions = facts.actions.filter((a) => a.validated || a.labelSource === 'human');

  const multimodal = [
    facts.observations.some((o) => o.evidenceKind === 'audio'),
    facts.observations.some((o) => o.evidenceKind === 'depth_scan'),
    facts.resources.some((r) => r.source === 'telemetry' || r.hasSettings),
    facts.resources.some((r) => r.kind === 'material' && r.hasLotOrSku),
  ].filter(Boolean).length;

  return [
    // Tier 1 — basic evidence.
    [
      {
        label: 'Any evidence at all: a video, photo or recorded reading',
        met: facts.observations.some((o) => o.hasMedia || o.hasReading),
      },
      { label: 'A work date', met: facts.hasWorkDate },
      { label: 'A task classification from the ontology', met: Boolean(facts.taskKey) },
      {
        label: 'Who performed the work',
        met: facts.performerNamed || facts.partyAttributed,
      },
    ],
    // Tier 2 — verified work episode.
    [
      { label: 'A capture of the existing condition, before work started', met: has(facts, 'existing_condition') },
      { label: 'A capture of the completed state', met: has(facts, 'complete') },
      { label: 'A location more specific than the job', met: facts.locationDepth !== 'none' && facts.locationDepth !== 'job' },
      { label: 'The intended result: a scope line, estimate line, or written intent', met: facts.hasIntent },
      { label: 'At least one labelled action', met: facts.actions.length > 0 },
      { label: 'A verification result of any kind', met: facts.verifications.length > 0 },
    ],
    // Tier 3 — multimodal episode.
    [
      {
        label: 'A capture from during the work — in progress, or before it was concealed',
        met: has(facts, 'in_progress') || has(facts, 'pre_conceal'),
      },
      {
        label: 'At least two of: narration audio, depth scan, tool telemetry, identified materials',
        met: multimodal >= 2,
      },
      {
        label: 'Ground truth — a result from someone or something other than the model',
        met: gt.length > 0,
      },
      { label: 'Materials or tools actually recorded', met: facts.resources.length > 0 },
    ],
    // Tier 4 — robotics-grade.
    [
      { label: 'Calibrated cameras', met: facts.calibration.calibratedCameras },
      { label: 'Precise geometry and object poses', met: facts.calibration.preciseGeometry && facts.calibration.objectPoses },
      { label: 'Force or torque data', met: facts.calibration.forceOrTorqueData },
      {
        label: 'Action labels reviewed by a person, not just produced by a model',
        met: facts.actions.length > 0 && validatedActions.length >= Math.ceil(facts.actions.length / 2),
      },
      {
        label: 'A failure and its correction, both recorded',
        met:
          facts.outcomes.some((o) => o.kind !== 'no_failure_observed' && o.corrected) ||
          (has(facts, 'failure') && has(facts, 'rework')),
      },
      {
        label: 'An instrument result, not only a signature',
        met: facts.verifications.some((v) => INSTRUMENT_KINDS.has(v.kind)),
      },
    ],
    // Tier 5 — closed loop.
    [
      { label: 'A robot attempt at this task', met: facts.robot.attempted },
      { label: 'Robot control data recorded', met: facts.robot.controlsRecorded },
      { label: 'Human intervention captured', met: facts.robot.humanIntervened },
      { label: 'The corrected robot behaviour recorded', met: facts.robot.correctedBehaviourRecorded },
      {
        label: 'A verified outcome for the attempt',
        met: groundTruth(facts).some((v) => v.result !== 'inconclusive'),
      },
    ],
  ];
}

export function assessTier(facts: EpisodeFacts): { tier: Tier; missingForNextTier: string[] } {
  const rungs = rungRequirements(facts);

  // Climb from the bottom and stop at the first rung with a gap. Stopping
  // rather than continuing is the monotonicity guarantee: depth data cannot
  // buy a tier while a before-and-after is missing.
  let climbed = 0;
  for (const rung of rungs) {
    if (!rung.every((check) => check.met)) break;
    climbed += 1;
  }

  // There is no tier 0. An episode that fails even the basics is reported as
  // Tier 1 with its own gaps listed, because hiding it from the listing is how
  // it never gets fixed.
  const tier = (Math.max(1, climbed) as Tier);
  const nextRung = climbed >= rungs.length ? [] : rungs[climbed];

  return {
    tier,
    missingForNextTier: nextRung.filter((check) => !check.met).map((check) => check.label),
  };
}

/* ------------------------------------------------------------------ *
 * Confidence
 * ------------------------------------------------------------------ */

export function assessConfidence(facts: EpisodeFacts): Record<ConfidenceDimension, DimensionScore> {
  const gt = groundTruth(facts);
  const passes = gt.filter((v) => v.result === 'pass');
  const fails = gt.filter((v) => v.result === 'fail');
  const inconclusive = gt.filter((v) => v.result === 'inconclusive');
  const aiSaysComplete = facts.verifications.some((v) => v.kind === 'ai_analysis' && v.result === 'pass');

  /* --- identity --- */
  let identity: DimensionScore;
  if (facts.performerNamed && facts.partyAttributed) {
    identity = { score: 0.95, basis: 'A named person, attached to a company on this job.' };
  } else if (facts.performerNamed) {
    identity = { score: 0.8, basis: 'A named account performed this; no company attribution.' };
  } else if (facts.partyAttributed) {
    identity = { score: 0.5, basis: 'The company is known, the individual is not.' };
  } else {
    identity = { score: 0.15, basis: 'Nobody is attached to this episode beyond the job.' };
  }

  /* --- location --- */
  const locationBase = LOCATION_SCORE[facts.locationDepth];
  const location: DimensionScore = {
    score: round2(locationBase + (facts.hasModelElement ? 0.05 : 0)),
    basis:
      facts.locationDepth === 'none'
        ? 'No location beyond the job record.'
        : `Pinned to ${facts.locationDepth}${facts.hasModelElement ? ', linked to a model element' : ''}.`,
  };

  /* --- time --- */
  // Built from the verifier's findings rather than from the timestamps
  // themselves: a device clock agrees with the server or it does not, and that
  // disagreement is the whole signal.
  let time: DimensionScore;
  const { passed, failed, unknown } = facts.proofChecks;
  if (failed > 0) {
    time = { score: 0.1, basis: `${failed} timing or location check${failed === 1 ? '' : 's'} failed.` };
  } else if (passed > 0 && unknown === 0 && facts.hasStartEnd) {
    time = { score: 0.95, basis: 'Capture times verified, and the episode has a start and end.' };
  } else if (passed > 0 && unknown === 0) {
    time = { score: 0.8, basis: 'Capture times verified; no explicit start and end recorded.' };
  } else if (passed > 0) {
    time = { score: 0.6, basis: `Capture times verified, but ${unknown} check${unknown === 1 ? '' : 's'} could not run.` };
  } else if (facts.hasWorkDate) {
    time = { score: 0.3, basis: 'A work date was asserted; nothing corroborates it.' };
  } else {
    time = { score: 0.05, basis: 'No usable time information.' };
  }

  /* --- task classification --- */
  let taskScore = 0.1;
  let taskBasis = 'Unclassified.';
  if (facts.taskKey) {
    const sourceScore =
      facts.taskLabelSource === 'human' ? 0.95 : facts.taskLabelSource === 'rule' ? 0.75 : 0.55;
    // A stub definition classifies less reliably: there is less in it to be
    // right or wrong about.
    const maturityPenalty = facts.taskMaturity === 'stub' ? 0.15 : 0;
    taskScore = sourceScore - maturityPenalty;
    taskBasis =
      `${facts.taskLabelSource === 'human' ? 'Classified by a person' : facts.taskLabelSource === 'rule' ? 'Classified by rule' : 'Classified by the model'}` +
      (facts.taskMaturity === 'stub' ? ', against a stub task definition.' : '.');
  }
  const task_classification: DimensionScore = { score: round2(taskScore), basis: taskBasis };

  /* --- action labelling --- */
  let action_labeling: DimensionScore;
  if (facts.actions.length === 0) {
    action_labeling = { score: 0, basis: 'No action sequence recorded.' };
  } else {
    const reviewed = facts.actions.filter((a) => a.validated || a.labelSource === 'human').length;
    const share = reviewed / facts.actions.length;
    const modelConfidences = facts.actions
      .filter((a) => !a.validated && a.labelSource === 'ai')
      .map((a) => a.confidence ?? 0.4);
    const modelMean =
      modelConfidences.length > 0
        ? modelConfidences.reduce((s, c) => s + c, 0) / modelConfidences.length
        : 1;
    // Reviewed labels are worth roughly twice an unreviewed one, and an
    // unreviewed label is capped by the model's own stated confidence.
    action_labeling = {
      score: round2(share * 0.95 + (1 - share) * Math.min(0.6, modelMean * 0.6)),
      basis: `${reviewed} of ${facts.actions.length} action labels reviewed by a person.`,
    };
  }

  /* --- material identification --- */
  const materials = facts.resources.filter((r) => r.kind === 'material');
  let material_identification: DimensionScore;
  if (materials.length === 0) {
    material_identification = { score: 0, basis: 'No materials recorded.' };
  } else {
    const best = Math.max(
      ...materials.map((m) => {
        if (m.hasLotOrSku && m.source === 'purchase_order') return 0.95;
        if (m.source === 'purchase_order') return 0.85;
        if (m.hasLotOrSku) return 0.8;
        if (m.source === 'human') return 0.6;
        return 0.35;
      }),
    );
    material_identification = {
      score: round2(best),
      basis: materials.some((m) => m.source === 'purchase_order')
        ? 'Materials tie back to a purchase order.'
        : materials.some((m) => m.hasLotOrSku)
          ? 'Materials carry a SKU or lot number.'
          : 'Materials are named but unverified.',
    };
  }

  /* --- completion --- */
  // The dimension the money hangs off, and therefore the strictest. A model
  // saying it looks done moves this very little; a fail sinks it outright.
  let completion: DimensionScore;
  if (fails.length > 0) {
    completion = { score: 0.05, basis: 'A verification failed. This work is not complete.' };
  } else if (passes.length > 0 && has(facts, 'complete')) {
    completion = {
      score: round2(0.8 + Math.min(0.15, passes.length * 0.05)),
      basis: `${passes.length} independent verification${passes.length === 1 ? '' : 's'} passed, with a completed-state capture.`,
    };
  } else if (passes.length > 0) {
    completion = { score: 0.65, basis: 'Verified as passing, but no capture of the finished state.' };
  } else if (inconclusive.length > 0) {
    completion = {
      score: 0.25,
      basis: 'Somebody looked and could not tell. Inconclusive is not a pass.',
    };
  } else if (aiSaysComplete) {
    completion = {
      score: 0.35,
      basis: 'Only the model considers this complete. Nothing independent has confirmed it.',
    };
  } else if (has(facts, 'complete')) {
    completion = { score: 0.2, basis: 'A finished state was filmed; nothing has judged it.' };
  } else {
    completion = { score: 0.05, basis: 'Nothing indicates this work was finished.' };
  }

  /* --- quality --- */
  // Deliberately unreachable without instruments or an inspection. Good
  // footage of bad work looks exactly like good footage of good work.
  let quality: DimensionScore;
  const instrument = facts.verifications.filter((v) => INSTRUMENT_KINDS.has(v.kind));
  const measured = instrument.filter((v) => v.hasMeasurement);
  if (fails.length > 0) {
    quality = { score: 0.05, basis: 'A verification failed.' };
  } else if (measured.some((v) => v.result === 'pass')) {
    quality = { score: 0.9, basis: 'A measured instrument result passed.' };
  } else if (instrument.some((v) => v.result === 'pass')) {
    quality = { score: 0.7, basis: 'An instrument test passed, without a recorded measurement.' };
  } else if (gt.some((v) => v.kind === 'code_inspection' && v.result === 'pass')) {
    quality = { score: 0.75, basis: 'Passed a code inspection.' };
  } else if (passes.length > 0) {
    quality = { score: 0.45, basis: 'Accepted by a person, with nothing measured.' };
  } else {
    quality = { score: 0.1, basis: 'Nothing here speaks to whether the work was done well.' };
  }

  /* --- responsibility --- */
  const responsibility: DimensionScore = (() => {
    if (!facts.partyAttributed && !facts.performerNamed) {
      return { score: 0.1, basis: 'Nobody is on the hook for this episode.' };
    }
    const consentBonus = facts.workerConsent === 'granted' ? 0.1 : 0;
    const base = facts.partyAttributed && facts.performerNamed ? 0.85 : 0.55;
    return {
      score: round2(base + consentBonus),
      basis:
        facts.partyAttributed && facts.performerNamed
          ? 'Company and individual both identified.'
          : 'Partially attributed.',
    };
  })();

  /* --- outcome --- */
  let outcome: DimensionScore;
  const durable = facts.outcomes.filter((o) => (o.daysAfterWork ?? 0) >= 90);
  if (facts.outcomes.length === 0) {
    outcome = {
      score: 0,
      basis: 'Nothing is known about what happened afterwards. Silence is not durability.',
    };
  } else if (facts.outcomes.some((o) => o.kind !== 'no_failure_observed')) {
    const failure = facts.outcomes.find((o) => o.kind !== 'no_failure_observed')!;
    outcome = {
      score: failure.corrected ? 0.85 : 0.6,
      basis: failure.corrected
        ? 'A failure was recorded and its correction is linked — the most useful shape there is.'
        : 'A failure was recorded with no correction linked.',
    };
  } else if (durable.length > 0) {
    outcome = {
      score: round2(0.7 + Math.min(0.25, (durable[0].daysAfterWork ?? 90) / 730)),
      basis: `Checked ${durable[0].daysAfterWork} days later with no failure found.`,
    };
  } else {
    outcome = {
      score: 0.3,
      basis: 'Checked, but too soon after the work to say much.',
    };
  }

  return {
    identity,
    location,
    time,
    task_classification,
    action_labeling,
    material_identification,
    completion,
    quality,
    responsibility,
    outcome,
  };
}

/**
 * Tie-break order for `weakest`.
 *
 * Ties are common — several dimensions sit at zero on a young episode — and
 * resolving them by whichever key happened to be declared first would make the
 * answer arbitrary. So the order is stated, and it is ordered by what somebody
 * can do about it today.
 *
 * `outcome` comes last deliberately. It is zero on every episode the day the
 * work is done, and it stays zero until enough time has passed to check; there
 * is no action that fixes it now, so surfacing it as "the thing to fix" would
 * be noise on every fresh record. Completion and quality lead because they are
 * what a payment decision turns on.
 */
const WEAKEST_PRIORITY: ConfidenceDimension[] = [
  'completion',
  'quality',
  'time',
  'identity',
  'location',
  'task_classification',
  'action_labeling',
  'material_identification',
  'responsibility',
  'outcome',
];

export function assessEpisode(facts: EpisodeFacts): EpisodeAssessment {
  const { tier, missingForNextTier } = assessTier(facts);
  const confidence = assessConfidence(facts);

  const weakest = WEAKEST_PRIORITY.reduce((lowest, key) =>
    confidence[key].score < confidence[lowest].score ? key : lowest,
  );

  return { tier, missingForNextTier, confidence, weakest };
}

/** A blank episode, for callers building facts up field by field. */
export function emptyFacts(): EpisodeFacts {
  return {
    taskKey: null,
    taskLabelSource: 'ai',
    taskMaturity: null,
    hasIntent: false,
    performerKind: 'human',
    performerNamed: false,
    partyAttributed: false,
    workerConsent: 'not_asked',
    locationDepth: 'none',
    hasModelElement: false,
    hasWorkDate: false,
    hasStartEnd: false,
    proofChecks: { passed: 0, failed: 0, unknown: 0 },
    hasGeotaggedMedia: false,
    observations: [],
    actions: [],
    resources: [],
    verifications: [],
    outcomes: [],
    economics: { present: false, hasCosts: false, hasSettlement: false },
    calibration: {
      calibratedCameras: false,
      preciseGeometry: false,
      objectPoses: false,
      forceOrTorqueData: false,
    },
    robot: {
      attempted: false,
      controlsRecorded: false,
      humanIntervened: false,
      correctedBehaviourRecorded: false,
    },
  };
}
