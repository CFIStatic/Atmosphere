/**
 * LLM verifier + ontology-oriented tests (mocked providers only).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MockVerificationProvider,
  MockEscalationProvider,
  shouldEscalateVerification,
  workEventVerificationResultSchema,
} from '../../src/verification/ai/llmVerifier.js';
import { BUILTIN_RULES, evaluateRule } from '../../src/verification/rules/engine.js';
import { parseModelJson } from '../../src/verification/schemas.js';
import {
  getPrompt,
  VERIFIER_PROMPT_KEY,
  VERIFIER_PROMPT_VERSION,
} from '../../src/verification/prompts/registry.js';

test('prompt registry returns versioned verifier instructions', () => {
  const prompt = getPrompt(VERIFIER_PROMPT_KEY, VERIFIER_PROMPT_VERSION);
  assert.match(prompt.systemInstructions, /skeptical/i);
  assert.equal(prompt.outputSchemaVersion, 'v1');
});

test('LLM verifier rejects missing before/after evidence', async () => {
  const verifier = new MockVerificationProvider();
  const result = await verifier.verifyWorkEvent({
    proposedActivity: 'drywall_removed',
    roomOrArea: 'kitchen',
    beforeState: 'unknown',
    afterState: 'framing_exposed',
    beforeFrameIds: [],
    afterFrameIds: ['f2'],
    observations: ['exposed_studs'],
    contradictoryObservations: [],
    ruleChecklist: null,
    rule: null,
  });
  assert.equal(result.parsed.decision, 'rejected');
  assert.ok(result.parsed.uncertainty_reasons.length > 0);
});

test('LLM verifier rejects identical before/after states', async () => {
  const verifier = new MockVerificationProvider();
  const result = await verifier.verifyWorkEvent({
    proposedActivity: 'drywall_removed',
    beforeState: 'drywall_present',
    afterState: 'drywall_present',
    beforeFrameIds: ['f1'],
    afterFrameIds: ['f2'],
    observations: [],
    contradictoryObservations: [],
    ruleChecklist: null,
    rule: null,
  });
  assert.equal(result.parsed.decision, 'rejected');
});

test('LLM verifier marks contradictory evidence as contradicted', async () => {
  const verifier = new MockVerificationProvider();
  const result = await verifier.verifyWorkEvent({
    proposedActivity: 'drywall_removed',
    beforeState: 'drywall_present',
    afterState: 'framing_exposed',
    beforeFrameIds: ['f1'],
    afterFrameIds: ['f2'],
    observations: [],
    contradictoryObservations: ['drywall_intact_later'],
    ruleChecklist: null,
    rule: null,
  });
  assert.equal(result.parsed.decision, 'contradicted');
});

test('LLM verifier can approve strong before/after evidence', async () => {
  const rule = BUILTIN_RULES.find((r) => r.activityType === 'drywall_removed')!;
  const checklist = evaluateRule(rule, {
    activityType: 'drywall_removed',
    observations: ['drywall_visible', 'exposed_studs'],
    beforeStates: ['drywall_present'],
    afterStates: ['framing_exposed', 'drywall_removed'],
    supportingFrameCount: 2,
    confidence: 0.9,
    contradictory: [],
  });
  const verifier = new MockVerificationProvider();
  const result = await verifier.verifyWorkEvent({
    proposedActivity: 'drywall_removed',
    roomOrArea: 'kitchen',
    beforeState: 'drywall_present',
    afterState: 'framing_exposed',
    beforeFrameIds: ['f1'],
    afterFrameIds: ['f2'],
    observations: ['drywall visible then studs'],
    contradictoryObservations: [],
    ruleChecklist: checklist,
    rule,
  });
  assert.equal(result.parsed.decision, 'verified');
  assert.equal(result.parsed.completion_state, 'complete');
  assert.ok(result.parsed.supporting_evidence.length >= 1);
});

test('LLM verifier schema validation rejects optimistic free text', () => {
  assert.throws(() =>
    parseModelJson(
      JSON.stringify({
        decision: 'looks_good',
        proposed_activity: 'drywall_removed',
        before_state: { description: 'x', evidence_frame_ids: [] },
        after_state: { description: 'y', evidence_frame_ids: [] },
        sequence_analysis: 'fine',
        completion_state: 'complete',
        model_confidence: 0.9,
        supporting_evidence: [],
        contradictory_evidence: [],
        uncertainty_reasons: [],
        required_follow_up: null,
      }),
      workEventVerificationResultSchema,
    ),
  );
});

test('escalation creates a separate conservative review', async () => {
  const esc = new MockEscalationProvider();
  const prior = workEventVerificationResultSchema.parse({
    decision: 'uncertain',
    proposed_activity: 'drywall_removed',
    room_id: 'kitchen',
    before_state: { description: 'drywall', evidence_frame_ids: ['f1'] },
    after_state: { description: 'studs', evidence_frame_ids: ['f2'] },
    supporting_evidence: [],
    contradictory_evidence: [],
    sequence_analysis: 'unclear',
    completion_state: 'unknown',
    model_confidence: 0.4,
    uncertainty_reasons: ['low light'],
    required_follow_up: 'more frames',
  });
  const result = await esc.reviewDisputedEvent({
    proposedActivity: 'drywall_removed',
    beforeState: 'drywall_present',
    afterState: 'framing_exposed',
    beforeFrameIds: ['f1'],
    afterFrameIds: ['f2'],
    observations: [],
    contradictoryObservations: [],
    ruleChecklist: null,
    rule: null,
    priorDecision: prior,
    reason: 'primary_uncertain',
  });
  assert.ok(['verified', 'likely_verified', 'uncertain', 'rejected', 'contradicted', 'partially_verified'].includes(result.parsed.decision));
  assert.equal(result.provider, 'mock-escalation');
});

test('shouldEscalateVerification triggers on uncertain and high-risk', () => {
  assert.equal(
    shouldEscalateVerification({
      decision: 'uncertain',
      modelConfidence: 0.9,
      contradictory: false,
      highRisk: false,
      schemaFailures: 0,
      humanDisputed: false,
      disagreement: false,
    }),
    true,
  );
  assert.equal(
    shouldEscalateVerification({
      decision: 'verified',
      modelConfidence: 0.95,
      contradictory: false,
      highRisk: true,
      schemaFailures: 0,
      humanDisputed: false,
      disagreement: false,
    }),
    true,
  );
  assert.equal(
    shouldEscalateVerification({
      decision: 'verified',
      modelConfidence: 0.95,
      contradictory: false,
      highRisk: false,
      schemaFailures: 0,
      humanDisputed: false,
      disagreement: false,
    }),
    false,
  );
});
