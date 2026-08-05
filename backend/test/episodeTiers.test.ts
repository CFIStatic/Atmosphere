import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessConfidence,
  assessEpisode,
  assessTier,
  emptyFacts,
  type EpisodeFacts,
} from '../src/episodes/tiers.js';
import { capturePlan, taskByKey, TASKS, ontologyTree } from '../src/episodes/ontology.js';
import { normaliseAction, isWorkAction, ACTION_DEFINITIONS, WORK_ACTIONS } from '../src/episodes/actions.js';

/**
 * The scoring is the product here — it decides what a dataset is worth and
 * what a crew is told to do next — so the tests are written around the ways it
 * could flatter an episode that does not deserve it.
 */

/** A Tier 2 episode: everything the second rung asks for, nothing above it. */
function tier2(): EpisodeFacts {
  return {
    ...emptyFacts(),
    taskKey: 'mit.demolition.flood_cut',
    taskLabelSource: 'human',
    taskMaturity: 'seeded',
    hasIntent: true,
    performerNamed: true,
    partyAttributed: true,
    locationDepth: 'room',
    hasWorkDate: true,
    proofChecks: { passed: 4, failed: 0, unknown: 0 },
    observations: [
      { phase: 'existing_condition', evidenceKind: 'video', hasMedia: true, hasReading: false },
      { phase: 'complete', evidenceKind: 'video', hasMedia: true, hasReading: false },
    ],
    actions: [
      { labelSource: 'ai', confidence: 0.8, validated: false, hasTiming: true, hasTool: true, hasMaterial: false },
    ],
    verifications: [{ kind: 'ai_analysis', result: 'pass', hasMeasurement: false }],
  };
}

test('an empty episode is Tier 1 and says what it lacks', () => {
  const { tier, missingForNextTier } = assessTier(emptyFacts());
  assert.equal(tier, 1);
  assert.ok(missingForNextTier.length >= 3);
  assert.ok(missingForNextTier.some((m) => /evidence/i.test(m)));
});

test('the shipped before/after flow reaches Tier 2 and no further', () => {
  const { tier, missingForNextTier } = assessTier(tier2());
  assert.equal(tier, 2);
  // The next thing to ask a crew for is a mid-work or pre-conceal capture.
  assert.ok(missingForNextTier.some((m) => /in progress|concealed/i.test(m)));
  assert.ok(missingForNextTier.some((m) => /ground truth/i.test(m)));
});

test('tiers are monotonic — depth data cannot buy a rung while a basic is missing', () => {
  const facts: EpisodeFacts = {
    ...tier2(),
    // Everything a Tier 3 and Tier 4 episode would carry...
    observations: [
      { phase: 'existing_condition', evidenceKind: 'video', hasMedia: true, hasReading: false },
      { phase: 'pre_conceal', evidenceKind: 'depth_scan', hasMedia: true, hasReading: false },
      { phase: 'in_progress', evidenceKind: 'audio', hasMedia: true, hasReading: false },
      // ...but no capture of the completed state, which Tier 2 requires.
    ],
    resources: [
      { kind: 'material', source: 'purchase_order', hasSettings: false, hasLotOrSku: true },
      { kind: 'tool', source: 'telemetry', hasSettings: true, hasLotOrSku: false },
    ],
    verifications: [{ kind: 'pressure_test', result: 'pass', hasMeasurement: true }],
    calibration: {
      calibratedCameras: true,
      preciseGeometry: true,
      objectPoses: true,
      forceOrTorqueData: true,
    },
  };
  const { tier, missingForNextTier } = assessTier(facts);
  assert.equal(tier, 1, 'a missing completed-state capture holds the episode at Tier 1');
  assert.ok(missingForNextTier.some((m) => /completed state/i.test(m)));
});

test('an AI verdict is not ground truth — it cannot lift an episode to Tier 3', () => {
  const facts: EpisodeFacts = {
    ...tier2(),
    observations: [
      ...tier2().observations,
      { phase: 'pre_conceal', evidenceKind: 'video', hasMedia: true, hasReading: false },
      { phase: 'in_progress', evidenceKind: 'audio', hasMedia: true, hasReading: false },
    ],
    resources: [
      { kind: 'material', source: 'purchase_order', hasSettings: false, hasLotOrSku: true },
      { kind: 'tool', source: 'telemetry', hasSettings: true, hasLotOrSku: false },
    ],
    // Several AI passes, and nothing else.
    verifications: [
      { kind: 'ai_analysis', result: 'pass', hasMeasurement: false },
      { kind: 'ai_analysis', result: 'pass', hasMeasurement: false },
    ],
  };
  const { tier, missingForNextTier } = assessTier(facts);
  assert.equal(tier, 2);
  assert.ok(missingForNextTier.some((m) => /ground truth/i.test(m)));

  // And one real result gets it there.
  const withGroundTruth = {
    ...facts,
    verifications: [...facts.verifications, { kind: 'moisture_reading' as const, result: 'pass' as const, hasMeasurement: true }],
  };
  assert.equal(assessTier(withGroundTruth).tier, 3);
});

test('Tier 4 needs human-reviewed labels and a failure/correction pair', () => {
  const base: EpisodeFacts = {
    ...tier2(),
    observations: [
      ...tier2().observations,
      { phase: 'pre_conceal', evidenceKind: 'depth_scan', hasMedia: true, hasReading: false },
    ],
    resources: [
      { kind: 'material', source: 'purchase_order', hasSettings: false, hasLotOrSku: true },
      { kind: 'tool', source: 'telemetry', hasSettings: true, hasLotOrSku: false },
    ],
    verifications: [{ kind: 'pressure_test', result: 'pass', hasMeasurement: true }],
    calibration: {
      calibratedCameras: true,
      preciseGeometry: true,
      objectPoses: true,
      forceOrTorqueData: true,
    },
    actions: [
      { labelSource: 'ai', confidence: 0.9, validated: false, hasTiming: true, hasTool: true, hasMaterial: true },
      { labelSource: 'ai', confidence: 0.9, validated: false, hasTiming: true, hasTool: true, hasMaterial: true },
    ],
  };
  assert.equal(assessTier(base).tier, 3, 'unreviewed labels and no failure data hold it at 3');

  const reviewed: EpisodeFacts = {
    ...base,
    actions: base.actions.map((a) => ({ ...a, validated: true })),
    outcomes: [{ kind: 'leak', daysAfterWork: 30, corrected: true }],
  };
  assert.equal(assessTier(reviewed).tier, 4);
});

test('Tier 5 requires the whole closed loop', () => {
  const four: EpisodeFacts = {
    ...tier2(),
    observations: [...tier2().observations, { phase: 'pre_conceal', evidenceKind: 'depth_scan', hasMedia: true, hasReading: false }],
    resources: [
      { kind: 'material', source: 'purchase_order', hasSettings: false, hasLotOrSku: true },
      { kind: 'tool', source: 'telemetry', hasSettings: true, hasLotOrSku: false },
    ],
    verifications: [{ kind: 'pressure_test', result: 'pass', hasMeasurement: true }],
    calibration: { calibratedCameras: true, preciseGeometry: true, objectPoses: true, forceOrTorqueData: true },
    actions: [{ labelSource: 'human', confidence: null, validated: true, hasTiming: true, hasTool: true, hasMaterial: true }],
    outcomes: [{ kind: 'leak', daysAfterWork: 30, corrected: true }],
  };
  assert.equal(assessTier(four).tier, 4);

  const five: EpisodeFacts = {
    ...four,
    robot: { attempted: true, controlsRecorded: true, humanIntervened: true, correctedBehaviourRecorded: true },
  };
  const result = assessTier(five);
  assert.equal(result.tier, 5);
  assert.deepEqual(result.missingForNextTier, [], 'nothing is missing above the top rung');
});

/* ---- confidence ---- */

test('an inconclusive verification never reads as completion', () => {
  const facts: EpisodeFacts = {
    ...tier2(),
    verifications: [{ kind: 'moisture_reading', result: 'inconclusive', hasMeasurement: true }],
  };
  const { completion } = assessConfidence(facts);
  assert.ok(completion.score <= 0.3, `inconclusive scored ${completion.score}`);
  assert.match(completion.basis, /not a pass/i);
});

test('a failed verification sinks completion and quality regardless of good footage', () => {
  const facts: EpisodeFacts = {
    ...tier2(),
    observations: [
      { phase: 'existing_condition', evidenceKind: 'video', hasMedia: true, hasReading: false },
      { phase: 'complete', evidenceKind: 'video', hasMedia: true, hasReading: false },
    ],
    verifications: [{ kind: 'code_inspection', result: 'fail', hasMeasurement: false }],
  };
  const { completion, quality } = assessConfidence(facts);
  assert.ok(completion.score < 0.1);
  assert.ok(quality.score < 0.1);
});

test('the model alone barely moves completion, and does not move quality', () => {
  const facts = tier2(); // its only verification is an ai_analysis pass
  const { completion, quality } = assessConfidence(facts);
  assert.ok(completion.score < 0.5, 'a model pass is not a completion');
  assert.ok(quality.score <= 0.1, 'nothing here speaks to quality');
  assert.match(completion.basis, /Only the model/i);
});

test('quality needs an instrument or an inspection, not a signature', () => {
  const signed: EpisodeFacts = {
    ...tier2(),
    verifications: [{ kind: 'gc_acceptance', result: 'pass', hasMeasurement: false }],
  };
  const measured: EpisodeFacts = {
    ...tier2(),
    verifications: [{ kind: 'pressure_test', result: 'pass', hasMeasurement: true }],
  };
  assert.ok(assessConfidence(signed).quality.score < assessConfidence(measured).quality.score);
});

test('unreviewed model labels are capped below reviewed ones', () => {
  const ai: EpisodeFacts = {
    ...tier2(),
    actions: [
      { labelSource: 'ai', confidence: 1, validated: false, hasTiming: true, hasTool: true, hasMaterial: true },
    ],
  };
  const human: EpisodeFacts = {
    ...ai,
    actions: ai.actions.map((a) => ({ ...a, validated: true })),
  };
  const aiScore = assessConfidence(ai).action_labeling.score;
  assert.ok(aiScore <= 0.6, `a fully confident model still capped, got ${aiScore}`);
  assert.ok(assessConfidence(human).action_labeling.score > aiScore);
});

test('a failed timing check outranks any number of passes', () => {
  const facts: EpisodeFacts = { ...tier2(), proofChecks: { passed: 6, failed: 1, unknown: 0 } };
  assert.ok(assessConfidence(facts).time.score < 0.2);
});

test('unknown checks lower time confidence without accusing anyone', () => {
  const unknown: EpisodeFacts = { ...tier2(), proofChecks: { passed: 3, failed: 0, unknown: 2 } };
  const clean: EpisodeFacts = { ...tier2(), proofChecks: { passed: 3, failed: 0, unknown: 0 } };
  const unknownScore = assessConfidence(unknown).time.score;
  assert.ok(unknownScore < assessConfidence(clean).time.score);
  assert.ok(unknownScore > assessConfidence({ ...tier2(), proofChecks: { passed: 6, failed: 1, unknown: 0 } }).time.score);
});

test('silence about the future is scored as zero, not as durability', () => {
  const { outcome } = assessConfidence(tier2());
  assert.equal(outcome.score, 0);
  assert.match(outcome.basis, /Silence is not durability/i);

  const checked: EpisodeFacts = {
    ...tier2(),
    outcomes: [{ kind: 'no_failure_observed', daysAfterWork: 365, corrected: false }],
  };
  assert.ok(assessConfidence(checked).outcome.score > 0.7);
});

test('a failure with its correction linked scores above one without', () => {
  const uncorrected: EpisodeFacts = { ...tier2(), outcomes: [{ kind: 'leak', daysAfterWork: 60, corrected: false }] };
  const corrected: EpisodeFacts = { ...tier2(), outcomes: [{ kind: 'leak', daysAfterWork: 60, corrected: true }] };
  assert.ok(
    assessConfidence(corrected).outcome.score > assessConfidence(uncorrected).outcome.score,
    'attempt -> failure -> correction is the shape worth having',
  );
});

test('assessEpisode names the weakest dimension so there is something to act on', () => {
  const result = assessEpisode(tier2());
  assert.equal(result.tier, 2);
  // Both material identification and durability sit at zero here. Durability
  // is unfixable on the day the work happened, so the actionable one surfaces.
  assert.equal(result.weakest, 'material_identification');
  assert.ok(result.missingForNextTier.length > 0);
});

test('the weakest dimension is deterministic, not declaration order', () => {
  const facts = tier2();
  const first = assessEpisode(facts).weakest;
  for (let i = 0; i < 5; i += 1) assert.equal(assessEpisode(facts).weakest, first);

  // Once completion is the floor on its own, it wins outright.
  const failed = assessEpisode({
    ...facts,
    resources: [{ kind: 'material', source: 'purchase_order', hasSettings: false, hasLotOrSku: true }],
    outcomes: [{ kind: 'no_failure_observed', daysAfterWork: 400, corrected: false }],
    verifications: [{ kind: 'code_inspection', result: 'fail', hasMeasurement: false }],
  });
  assert.ok(failed.weakest === 'completion' || failed.weakest === 'quality');
});

test('every confidence score stays inside 0..1', () => {
  const loaded: EpisodeFacts = {
    ...tier2(),
    workerConsent: 'granted',
    locationDepth: 'assembly',
    hasModelElement: true,
    hasStartEnd: true,
    outcomes: [{ kind: 'no_failure_observed', daysAfterWork: 900, corrected: false }],
    verifications: [
      { kind: 'pressure_test', result: 'pass', hasMeasurement: true },
      { kind: 'code_inspection', result: 'pass', hasMeasurement: false },
      { kind: 'gc_acceptance', result: 'pass', hasMeasurement: false },
    ],
  };
  for (const [dimension, score] of Object.entries(assessConfidence(loaded))) {
    assert.ok(score.score >= 0 && score.score <= 1, `${dimension} out of range: ${score.score}`);
    assert.ok(score.basis.length > 0, `${dimension} has no stated basis`);
  }
});

/* ---- ontology ---- */

test('every task key is unique and every stub says it is one', () => {
  const keys = TASKS.map((t) => t.key);
  assert.equal(new Set(keys).size, keys.length, 'duplicate task key');
  for (const task of TASKS) {
    assert.ok(task.expectedActions.length > 0, `${task.key} has no expected actions`);
    for (const action of task.expectedActions) {
      assert.ok(isWorkAction(action), `${task.key} uses an unknown action ${action}`);
    }
    if (task.maturity === 'seeded') {
      assert.ok(task.tolerances.length > 0, `${task.key} claims to be seeded with no tolerances`);
      assert.ok(task.failureModes.length > 0, `${task.key} claims to be seeded with no failure modes`);
    }
  }
});

test('concealed work earns a required pre-conceal capture', () => {
  const floodCut = taskByKey('mit.demolition.flood_cut');
  assert.ok(floodCut?.concealedBy);
  const plan = capturePlan(floodCut!);
  const preConceal = plan.find((p) => p.phase === 'pre_conceal');
  assert.ok(preConceal, 'work that gets covered must demand a capture before it is');
  assert.equal(preConceal.required, true);
  assert.match(preConceal.why, /cannot be re-created/i);

  // Monitoring visits conceal nothing, so they do not demand one.
  const monitoring = taskByKey('mit.drying.monitoring_visit');
  assert.ok(!capturePlan(monitoring!).some((p) => p.phase === 'pre_conceal'));
});

test('the plumbing worked example carries its full sequence and hidden failures', () => {
  const elbow = taskByKey('plumb.copper.install_elbow');
  assert.ok(elbow);
  for (const step of ['measure', 'cut', 'clean', 'apply', 'connect', 'test'] as const) {
    assert.ok(elbow.expectedActions.includes(step), `missing ${step}`);
  }
  assert.ok(elbow.verification.some((v) => v.kind === 'pressure_test' && v.required));
  const hidden = elbow.failureModes.filter((f) => f.hiddenAfterConcealment);
  assert.ok(hidden.length >= 3, 'a soldered joint fails in ways nobody can see later');
});

test('the tree groups without losing a task', () => {
  const counted = ontologyTree()
    .flatMap((t) => t.systems)
    .flatMap((s) => s.assemblies)
    .flatMap((a) => a.tasks).length;
  assert.equal(counted, TASKS.length);
});

/* ---- action vocabulary ---- */

test('synonyms land on the vocabulary and unknown verbs return null', () => {
  assert.equal(normaliseAction('Solder'), 'connect');
  assert.equal(normaliseAction('tear out'), 'remove');
  assert.equal(normaliseAction('screw'), 'fasten');
  assert.equal(normaliseAction('cut'), 'cut');
  // Refuses to guess rather than mapping a verb it does not know.
  assert.equal(normaliseAction('prime'), null);
  assert.equal(normaliseAction('flange'), null);
});

test('every action has a definition and the confusable pairs are called out', () => {
  for (const action of WORK_ACTIONS) {
    assert.ok(ACTION_DEFINITIONS[action]?.meaning, `${action} has no meaning`);
  }
  assert.ok(ACTION_DEFINITIONS.connect.notConfusedWith);
  assert.ok(ACTION_DEFINITIONS.align.notConfusedWith);
});
