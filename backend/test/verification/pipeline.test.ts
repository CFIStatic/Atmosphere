/**
 * Verification pipeline unit tests.
 *
 * AI calls are always mocked — the suite must never require paid model access.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import {
  validateUploadConstraints,
  buildStoragePath,
} from '../../src/verification/ingestion/service.js';
import {
  scoreFrameBytes,
  selectFramesForAnalysis,
  hammingDistanceHex,
  perceptualHash,
  cosineSimilarity,
  heuristicLuminanceSampler,
} from '../../src/verification/quality/filter.js';
import { groupFramesIntoScenes, normalizeRoomType } from '../../src/verification/scenes/group.js';
import {
  frameObservationSchema,
  parseModelJson,
  createVideoUploadSchema,
} from '../../src/verification/schemas.js';
import { detectChangeEvents } from '../../src/verification/temporal/compare.js';
import {
  evaluateRule,
  evaluateAllRules,
  BUILTIN_RULES,
} from '../../src/verification/rules/engine.js';
import { scoreConfidence, statusFromConfidence } from '../../src/verification/confidence/score.js';
import {
  MockVisionAnalyzer,
  shouldEscalate,
} from '../../src/verification/ai/analyzer.js';
import { ProcessingOrchestrator } from '../../src/verification/pipeline/orchestrator.js';
import { groupTimelineByRoom } from '../../src/verification/reporting/report.js';
import type { TimelineEvent } from '../../src/verification/types.js';
import { humanReviewDecisionSchema } from '../../src/verification/schemas.js';

// ---------------------------------------------------------------------------
// Upload validation
// ---------------------------------------------------------------------------

test('upload validation rejects bad mime and oversized files', () => {
  assert.equal(
    validateUploadConstraints({ mimeType: 'application/pdf' }).ok,
    false,
  );
  assert.equal(
    validateUploadConstraints({ mimeType: 'video/mp4', fileSize: 0 }).ok,
    false,
  );
  assert.equal(
    validateUploadConstraints({ mimeType: 'video/mp4', fileSize: 1000, durationSeconds: 30 })
      .ok,
    true,
  );
});

test('createVideoUploadSchema rejects path separators in file names', () => {
  assert.throws(() =>
    createVideoUploadSchema.parse({
      jobId: '11111111-1111-1111-1111-111111111111',
      fileName: '../evil.mp4',
    }),
  );
});

test('buildStoragePath is org/job scoped and sanitized', () => {
  const path = buildStoragePath({
    orgId: 'org1',
    jobId: 'job1',
    videoId: 'vid1',
    fileName: 'Kitchen Walk.mp4',
    mimeType: 'video/mp4',
  });
  assert.match(path, /^org1\/job1\/verification\/vid1\/original\./);
  assert.ok(!path.includes(' '));
});

// ---------------------------------------------------------------------------
// Quality / dedup
// ---------------------------------------------------------------------------

test('blurry or dark frames score poorly and can be rejected', () => {
  const dark = Buffer.alloc(3000, 5);
  const scored = scoreFrameBytes(dark, null, heuristicLuminanceSampler);
  assert.ok(scored.brightnessScore < 0.2);
  assert.ok(scored.qualityScore < 0.6);
});

test('perceptual hash hamming distance is zero for identical buffers', () => {
  const buf = Buffer.alloc(9000, 120);
  const a = scoreFrameBytes(buf, null);
  const b = scoreFrameBytes(buf, null);
  assert.equal(hammingDistanceHex(a.perceptualHash, b.perceptualHash), 0);
});

test('selectFramesForAnalysis reduces volume aggressively', () => {
  const scored = Array.from({ length: 100 }, (_, i) => ({
    id: `f${i}`,
    sequenceNumber: i,
    timestampSeconds: i * 2,
    scores: {
      qualityScore: 0.5 + (i % 10) / 20,
      blurScore: 0.2,
      brightnessScore: 0.45,
      motionScore: 0.1,
    },
    perceptualHash: perceptualHash(8, 8, new Uint8Array(64).fill(i)),
    rejected: i % 7 === 0,
    rejectionReason: i % 7 === 0 ? 'blurry' : null,
    isDuplicate: i % 5 === 0 && i > 0,
    duplicateOf: i % 5 === 0 && i > 0 ? 'f0' : null,
    selectedForAnalysis: false,
  }));
  const selected = selectFramesForAnalysis(scored, { maxRatio: 0.2 });
  const n = selected.filter((f) => f.selectedForAnalysis).length;
  assert.ok(n <= 20, `expected ≤20 selected, got ${n}`);
  assert.ok(n >= 1);
  // ≥80% reduction relative to total frames
  assert.ok(1 - n / scored.length >= 0.8);
});

test('cosine similarity of identical vectors is 1', () => {
  assert.ok(Math.abs(cosineSimilarity([1, 2, 3], [1, 2, 3]) - 1) < 1e-9);
});

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

test('groupFramesIntoScenes splits on large perceptual gaps', () => {
  const frames = [
    { id: 'a', timestampSeconds: 0, perceptualHash: '0000000000000000' },
    { id: 'b', timestampSeconds: 2, perceptualHash: '0000000000000001' },
    { id: 'c', timestampSeconds: 8, perceptualHash: 'ffffffffffffffff' },
    { id: 'd', timestampSeconds: 10, perceptualHash: 'fffffffffffffffe' },
  ];
  const scenes = groupFramesIntoScenes(frames, { minSceneSeconds: 3 });
  assert.ok(scenes.length >= 2);
  assert.equal(normalizeRoomType('Master Bedroom'), 'bedroom');
  assert.equal(normalizeRoomType('outside'), 'exterior');
});

// ---------------------------------------------------------------------------
// AI schema validation
// ---------------------------------------------------------------------------

test('parseModelJson accepts fenced JSON and rejects garbage', () => {
  const good = parseModelJson(
    '```json\n{"room_type":"kitchen","observed_conditions":[],"damage_types":[],"work_activities":["drywall_removed"],"materials_present":[],"equipment_present":[],"completion_indicators":[],"safety_issues":[],"visible_text":[],"uncertainty_reasons":[],"confidence":0.7,"evidence_regions":[]}\n```',
    frameObservationSchema,
  );
  assert.equal(good.room_type, 'kitchen');
  assert.throws(() => parseModelJson('not json', frameObservationSchema));
  assert.throws(() =>
    parseModelJson('{"room_type":"kitchen","confidence":2}', frameObservationSchema),
  );
});

test('MockVisionAnalyzer returns schema-valid observations without network', async () => {
  const analyzer = new MockVisionAnalyzer();
  const result = await analyzer.analyzeFrame({
    mimeType: 'image/jpeg',
    base64: 'abc',
    frameId: 'f1',
  });
  assert.equal(result.provider, 'mock');
  assert.ok(result.parsed.confidence <= 1);
  const cmp = await analyzer.compareFrames(
    { mimeType: 'image/jpeg', base64: 'a' },
    { mimeType: 'image/jpeg', base64: 'b' },
  );
  assert.equal(cmp.parsed.inferred_activity, 'drywall_removed');
});

test('shouldEscalate triggers on low confidence and contradictions', () => {
  assert.equal(
    shouldEscalate({
      confidence: 0.2,
      schemaFailures: 0,
      disagreement: false,
      contradictory: false,
      rulesUnresolved: false,
      highRisk: false,
      humanRequested: false,
    }),
    true,
  );
  assert.equal(
    shouldEscalate({
      confidence: 0.9,
      schemaFailures: 0,
      disagreement: false,
      contradictory: false,
      rulesUnresolved: false,
      highRisk: false,
      humanRequested: false,
    }),
    false,
  );
  assert.equal(
    shouldEscalate({
      confidence: 0.9,
      schemaFailures: 0,
      disagreement: false,
      contradictory: true,
      rulesUnresolved: false,
      highRisk: false,
      humanRequested: false,
    }),
    true,
  );
});

// ---------------------------------------------------------------------------
// Temporal comparison
// ---------------------------------------------------------------------------

test('detectChangeEvents requires before and after, not a single frame', () => {
  const onlyAfter = detectChangeEvents([
    {
      frameId: 'f1',
      videoId: 'v1',
      sceneId: null,
      roomType: 'kitchen',
      timestampSeconds: 10,
      observedAt: '2026-08-01T10:00:00Z',
      activities: ['framing_exposed', 'drywall_removed'],
      conditions: ['framing_exposed'],
      equipment: [],
      materials: [],
      confidence: 0.8,
    },
  ]);
  assert.equal(onlyAfter.length, 0);

  const events = detectChangeEvents([
    {
      frameId: 'f1',
      videoId: 'v1',
      sceneId: 's1',
      roomType: 'kitchen',
      timestampSeconds: 5,
      observedAt: '2026-08-01T09:00:00Z',
      activities: [],
      conditions: ['drywall_present'],
      equipment: [],
      materials: ['drywall'],
      confidence: 0.8,
    },
    {
      frameId: 'f2',
      videoId: 'v2',
      sceneId: 's1',
      roomType: 'kitchen',
      timestampSeconds: 5,
      observedAt: '2026-08-01T15:00:00Z',
      activities: ['drywall_removed', 'framing_exposed'],
      conditions: ['framing_exposed', 'exposed_studs'],
      equipment: [],
      materials: ['wood_studs'],
      confidence: 0.85,
    },
  ]);
  assert.ok(events.some((e) => e.inferredActivity === 'drywall_removed'));
  const drywall = events.find((e) => e.inferredActivity === 'drywall_removed')!;
  assert.ok(drywall.beforeFrameIds.includes('f1'));
  assert.ok(drywall.afterFrameIds.includes('f2'));
  assert.notEqual(drywall.verificationStatus, 'verified'); // rules still apply later
});

// ---------------------------------------------------------------------------
// Rules engine
// ---------------------------------------------------------------------------

test('drywall removal rule requires before and after evidence', () => {
  const rule = BUILTIN_RULES.find((r) => r.activityType === 'drywall_removed')!;
  const fail = evaluateRule(rule, {
    activityType: 'drywall_removed',
    roomType: 'kitchen',
    observations: ['exposed_studs'],
    beforeStates: [],
    afterStates: ['framing_exposed'],
    supportingFrameCount: 1,
    confidence: 0.9,
    contradictory: [],
  });
  assert.equal(fail.passed, false);
  assert.ok(fail.missing.some((m) => m.startsWith('before:') || m.startsWith('frames:')));

  const pass = evaluateRule(rule, {
    activityType: 'drywall_removed',
    roomType: 'kitchen',
    observations: ['drywall_visible', 'exposed_studs'],
    beforeStates: ['drywall_present'],
    afterStates: ['framing_exposed', 'drywall_removed'],
    supportingFrameCount: 2,
    confidence: 0.9,
    contradictory: [],
  });
  assert.equal(pass.passed, true);
  assert.ok(['verified', 'likely_verified'].includes(pass.status));
});

test('contradictory evidence yields contradicted status', () => {
  const rule = BUILTIN_RULES.find((r) => r.activityType === 'drywall_removed')!;
  const result = evaluateRule(rule, {
    activityType: 'drywall_removed',
    observations: ['drywall_visible', 'exposed_studs'],
    beforeStates: ['drywall_present'],
    afterStates: ['framing_exposed', 'drywall_removed'],
    supportingFrameCount: 2,
    confidence: 0.9,
    contradictory: ['drywall_intact_later'],
  });
  assert.equal(result.status, 'contradicted');
  assert.equal(result.triggersReview, true);
});

test('unknown activity has no rule and triggers review', () => {
  const result = evaluateAllRules(BUILTIN_RULES, {
    activityType: 'teleportation_completed',
    observations: [],
    beforeStates: [],
    afterStates: [],
    supportingFrameCount: 2,
    confidence: 0.99,
    contradictory: [],
  });
  assert.ok(result);
  assert.equal(result!.passed, false);
  assert.ok(result!.reviewReasons.includes('unsupported_ai_claim'));
});

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

test('system confidence is not identical to model confidence', () => {
  const rules = evaluateRule(BUILTIN_RULES[0]!, {
    activityType: 'drywall_removed',
    observations: ['drywall_visible', 'exposed_studs'],
    beforeStates: ['drywall_present'],
    afterStates: ['framing_exposed', 'drywall_removed'],
    supportingFrameCount: 3,
    confidence: 0.95,
    contradictory: [],
  });
  const breakdown = scoreConfidence({
    modelConfidence: 0.95,
    supportingFrameCount: 3,
    visualQuality: 0.9,
    temporalConsistency: 0.9,
    sceneMatchConfidence: 0.85,
    modelAgreement: 0.9,
    rulesResult: rules,
    hasContradictoryEvidence: false,
    metadataQuality: 0.8,
    humanConfirmation: 0,
  });
  assert.notEqual(breakdown.final, breakdown.modelConfidence);
  assert.ok(breakdown.final > 0.7);

  const low = scoreConfidence({
    modelConfidence: 0.95,
    supportingFrameCount: 1,
    visualQuality: 0.2,
    temporalConsistency: 0.2,
    sceneMatchConfidence: 0.2,
    modelAgreement: 0.2,
    rulesResult: rules,
    hasContradictoryEvidence: true,
    metadataQuality: 0.1,
    humanConfirmation: 0,
  });
  assert.ok(low.final < breakdown.final);

  assert.equal(statusFromConfidence(breakdown, 'verified', { humanVerified: true }), 'human_verified');
});

// ---------------------------------------------------------------------------
// Human review schema
// ---------------------------------------------------------------------------

test('human review decisions validate and preserve audit fields', () => {
  const parsed = humanReviewDecisionSchema.parse({
    decision: 'approve',
    comment: 'Studs clearly visible after removal',
    reason: 'matches before/after',
  });
  assert.equal(parsed.decision, 'approve');
  assert.throws(() => humanReviewDecisionSchema.parse({ decision: 'yeet' }));
});

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

test('groupTimelineByRoom clusters events', () => {
  const timeline: TimelineEvent[] = [
    {
      id: '1',
      observedAt: '2026-08-01T09:04:00Z',
      roomOrArea: 'kitchen',
      title: 'Kitchen — damaged drywall observed',
      activityType: 'damage_observed',
      status: 'uncertain',
      systemConfidence: 0.5,
      modelConfidence: 0.6,
      summary: null,
      evidenceFrameIds: [],
      videoTimestamps: [],
      reviewStatus: null,
    },
    {
      id: '2',
      observedAt: '2026-08-01T09:18:00Z',
      roomOrArea: 'kitchen',
      title: 'Kitchen — drywall removal verified',
      activityType: 'drywall_removed',
      status: 'verified',
      systemConfidence: 0.9,
      modelConfidence: 0.85,
      summary: null,
      evidenceFrameIds: ['a', 'b'],
      videoTimestamps: [12, 40],
      reviewStatus: null,
    },
    {
      id: '3',
      observedAt: '2026-08-01T10:02:00Z',
      roomOrArea: 'bathroom',
      title: 'Bathroom — flooring removed',
      activityType: 'flooring_removed',
      status: 'likely_verified',
      systemConfidence: 0.75,
      modelConfidence: 0.7,
      summary: null,
      evidenceFrameIds: [],
      videoTimestamps: [],
      reviewStatus: 'open',
    },
  ];
  const byRoom = groupTimelineByRoom(timeline);
  assert.equal(byRoom.kitchen?.length, 2);
  assert.equal(byRoom.bathroom?.length, 1);
});

// ---------------------------------------------------------------------------
// Pipeline idempotency
// ---------------------------------------------------------------------------

test('processing orchestrator is idempotent on the same key and retries failures', async () => {
  const tick = () => new Promise((r) => setImmediate(r));
  async function drained(q: { pending: number }) {
    for (let i = 0; i < 400 && q.pending > 0; i += 1) await tick();
  }

  const store = {
    jobs: new Map<string, Record<string, unknown>>(),
    steps: new Map<string, Record<string, unknown>>(),
    videos: new Map<string, Record<string, unknown>>(),
  };

  // Minimal supabase mock for orchestrator.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase: any = {
    from(table: string) {
      const api = {
        _filters: {} as Record<string, unknown>,
        select() {
          return api;
        },
        insert(row: Record<string, unknown> | Record<string, unknown>[]) {
          if (table === 'video_processing_jobs') {
            const r = Array.isArray(row) ? row[0]! : row;
            const id = (r.id as string) ?? cryptoRandom();
            store.jobs.set(id, { ...r, id, status: r.status ?? 'pending' });
            return {
              select() {
                return {
                  single: async () => ({ data: store.jobs.get(id), error: null }),
                };
              },
              then: undefined,
            };
          }
          if (table === 'video_processing_steps') {
            const rows = Array.isArray(row) ? row : [row];
            for (const r of rows) {
              const id = cryptoRandom();
              store.steps.set(id, { ...r, id, status: 'pending', attempt_count: 0 });
            }
            return { error: null };
          }
          if (table === 'verification_audit_events') return { error: null };
          return { error: null };
        },
        update(patch: Record<string, unknown>) {
          const chain: {
            eq: (col: string, val: string) => typeof chain;
            then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => void;
          } = {
            eq(col: string, val: string) {
              if (table === 'video_processing_jobs' && col === 'id') {
                const job = store.jobs.get(val);
                if (job) store.jobs.set(val, { ...job, ...patch });
              }
              if (table === 'verification_videos' && col === 'id') {
                store.videos.set(val, { ...(store.videos.get(val) ?? {}), ...patch, id: val });
              }
              if (table === 'video_processing_steps') {
                if (col === 'id') {
                  const step = store.steps.get(val);
                  if (step) store.steps.set(val, { ...step, ...patch });
                } else {
                  for (const [id, step] of store.steps) {
                    if (step[col] === val) store.steps.set(id, { ...step, ...patch });
                  }
                }
              }
              return chain;
            },
            then(resolve) {
              resolve({ error: null });
            },
          };
          return chain;
        },
        eq(col: string, val: unknown) {
          api._filters[col] = val;
          return api;
        },
        maybeSingle: async () => {
          if (table === 'video_processing_jobs') {
            if (api._filters.idempotency_key) {
              for (const job of store.jobs.values()) {
                if (job.idempotency_key === api._filters.idempotency_key) {
                  return { data: job, error: null };
                }
              }
              return { data: null, error: null };
            }
            if (api._filters.id) {
              const job = store.jobs.get(api._filters.id as string);
              if (!job) return { data: null, error: null };
              return {
                data: {
                  ...job,
                  job_id: 'job-1',
                  verification_videos: { job_id: 'job-1', status: 'queued' },
                },
                error: null,
              };
            }
          }
          if (table === 'video_processing_steps') {
            for (const step of store.steps.values()) {
              if (
                step.processing_job_id === api._filters.processing_job_id &&
                step.stage === api._filters.stage
              ) {
                return { data: step, error: null };
              }
            }
            return { data: null, error: null };
          }
          return { data: null, error: null };
        },
      };
      return api;
    },
  };

  let validateRuns = 0;
  const orch = new ProcessingOrchestrator({
    delaysMs: [1],
    sleep: async () => undefined,
    handlers: {
      validate_video: async () => {
        validateRuns += 1;
        if (validateRuns === 1) throw new Error('transient');
        return { output: { ok: true } };
      },
      extract_metadata: async () => ({ output: {} }),
      extract_frames: async () => ({ output: { frameCount: 0 } }),
      score_frame_quality: async () => ({ output: {} }),
      deduplicate_frames: async () => ({ output: {} }),
      classify_scenes: async () => ({ output: {} }),
      analyze_frames: async () => ({ output: {} }),
      compare_timeline: async () => ({ output: {} }),
      generate_verifications: async () => ({ output: {} }),
      calculate_confidence: async () => ({ output: {} }),
      finalize_report: async () => ({ output: { done: true } }),
    },
  });

  store.videos.set('vid-1', { id: 'vid-1', status: 'uploaded' });

  const first = await orch.enqueue({
    supabase,
    orgId: 'org-1',
    videoId: 'vid-1',
    jobId: 'job-1',
    idempotencyKey: 'vid-1:v1',
  });
  const second = await orch.enqueue({
    supabase,
    orgId: 'org-1',
    videoId: 'vid-1',
    jobId: 'job-1',
    idempotencyKey: 'vid-1:v1',
  });
  assert.equal(first.processingJobId, second.processingJobId);
  assert.equal(first.created, true);
  assert.equal(second.created, false);

  await drained(orch);
  assert.ok(validateRuns >= 2, 'failed stage should retry');
  const job = store.jobs.get(first.processingJobId);
  assert.equal(job?.status, 'completed');
});

function cryptoRandom(): string {
  return `id-${Math.random().toString(16).slice(2)}-${Date.now()}`;
}

// Silence unused z import warning path if tree shakes oddly
void z;
