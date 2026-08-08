/**
 * Dataset layer tests: eligibility, privacy, splits, JSONL export, leakage.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateDatasetEligibility,
} from '../../src/verification/dataset/eligibility.js';
import {
  scanTextForPrivacy,
  privacyStatusFromFindings,
} from '../../src/verification/dataset/privacy.js';
import { assignSplit } from '../../src/verification/dataset/splits.js';
import {
  assertNoSplitLeakage,
  sha256Hex,
} from '../../src/verification/dataset/exportJsonl.js';
import {
  canonicalDatasetExampleSchema,
} from '../../src/verification/dataset/examples.js';
import { randomUUID } from 'node:crypto';

test('eligibility rejects operational_only and incomplete privacy', () => {
  const denied = evaluateDatasetEligibility({
    rights: { category: 'operational_only', trainingAllowed: false },
    privacyStatus: 'unknown',
    provenanceComplete: false,
    qualityScore: 0.9,
    purpose: 'training',
  });
  assert.equal(denied.eligible, false);
  assert.ok(denied.reasons.includes('operational_only'));
  assert.ok(denied.reasons.some((r) => r.startsWith('privacy_status:')));
  assert.ok(denied.reasons.includes('provenance_incomplete'));
  assert.ok(denied.reasons.includes('training_not_permitted'));
});

test('eligibility accepts training_allowed + export_safe + provenance', () => {
  const ok = evaluateDatasetEligibility({
    rights: {
      category: 'training_allowed',
      trainingAllowed: true,
      evaluationAllowed: true,
    },
    privacyStatus: 'export_safe',
    provenanceComplete: true,
    qualityScore: 0.9,
    purpose: 'training',
  });
  assert.equal(ok.eligible, true);
  assert.deepEqual(ok.reasons, []);
});

test('eligibility rejects revoked consent', () => {
  const denied = evaluateDatasetEligibility({
    rights: {
      category: 'training_allowed',
      trainingAllowed: true,
      revokedAt: new Date().toISOString(),
    },
    privacyStatus: 'export_safe',
    provenanceComplete: true,
    qualityScore: 0.95,
  });
  assert.equal(denied.eligible, false);
  assert.ok(denied.reasons.includes('rights_revoked'));
});

test('privacy text scan finds emails and phones', () => {
  const findings = scanTextForPrivacy([
    'Contact jane@example.com or 555-123-4567 on site',
  ]);
  assert.ok(findings.some((f) => f.type === 'email'));
  assert.ok(findings.some((f) => f.type === 'phone'));
  assert.equal(privacyStatusFromFindings(0), 'export_safe');
  assert.equal(privacyStatusFromFindings(2), 'review_required');
});

test('assignSplit is deterministic per project and prevents cross-project noise', () => {
  const a1 = assignSplit({ projectId: 'proj-aaa' });
  const a2 = assignSplit({ projectId: 'proj-aaa' });
  assert.equal(a1, a2);
  // Different seed changes assignment domain
  const b = assignSplit({ projectId: 'proj-aaa', seed: 'other-seed' });
  // May or may not equal — just ensure function returns a valid split
  assert.ok(['train', 'validation', 'test'].includes(a1));
  assert.ok(['train', 'validation', 'test'].includes(b));
});

test('assertNoSplitLeakage catches train+test for same project', () => {
  assert.throws(() =>
    assertNoSplitLeakage([
      { jobId: 'job-1', split: 'train' },
      { jobId: 'job-1', split: 'test' },
    ]),
  );
  assert.doesNotThrow(() =>
    assertNoSplitLeakage([
      { jobId: 'job-1', split: 'train' },
      { jobId: 'job-2', split: 'test' },
    ]),
  );
});

test('canonical dataset example schema validates vertical-slice record', () => {
  const exampleId = randomUUID();
  const parsed = canonicalDatasetExampleSchema.parse({
    example_id: exampleId,
    task_type: 'temporal_work_verification',
    ontology_version: 'v1',
    schema_version: '1.0.0',
    project_context: {
      industry_id: 'restoration',
      trade_id: 'water_mitigation',
      room_type_id: 'kitchen',
      component_type_id: null,
    },
    task: { task_id: 'drywall_removed' },
    media: {
      before_frames: ['frame_101'],
      during_clips: [],
      after_frames: ['frame_221'],
    },
    states: {
      before_state_id: 'damaged_drywall_present',
      after_state_id: 'studs_exposed',
    },
    verifier: {
      decision: 'verified',
      completion_state: 'complete',
      confidence: 0.96,
    },
    quality_score: 0.94,
    rights_manifest_id: randomUUID(),
    privacy_status: 'export_safe',
    provenance_manifest_id: randomUUID(),
    split: 'train',
    source: {
      org_id: randomUUID(),
      job_id: randomUUID(),
      video_id: randomUUID(),
      result_id: randomUUID(),
    },
  });
  assert.equal(parsed.task.task_id, 'drywall_removed');
  const line = JSON.stringify(parsed);
  assert.equal(sha256Hex(line).length, 64);
});
