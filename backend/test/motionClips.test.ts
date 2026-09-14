import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MOTION_CLIPS_SCHEMA,
  bucketMotionClipsByType,
  deriveMotionClips,
  listKnownMotionTypes,
  motionClipsFromProofRow,
  motionClipsFromStored,
  narrowMotionFromEvidence,
  publicMotionClipsFields,
  toStoredMotionClips,
} from '../src/shared/motionClips.js';

test('narrowMotionFromEvidence prefers screw over fasten when evidenced', () => {
  const hit = narrowMotionFromEvidence({
    action: 'fasten',
    description: 'Driving a screw into the top plate',
    toolLabel: 'drill/driver',
  });
  assert.ok(hit);
  assert.equal(hit!.motion, 'screw');
  assert.equal(hit!.action, 'fasten');
});

test('narrowMotionFromEvidence returns null when nothing is evidenced', () => {
  assert.equal(
    narrowMotionFromEvidence({ action: 'other', description: 'Something happened on site' }),
    null,
  );
  assert.equal(narrowMotionFromEvidence({ description: '' }), null);
});

test('deriveMotionClips builds timed segments and skips wait/other', () => {
  const { clips, excludedForPrivacy } = deriveMotionClips([
    {
      atSeconds: 12,
      endSeconds: 18,
      action: 'cut',
      description: 'Cutting OSB with circular saw',
      toolLabel: 'circular saw',
      confidence: 0.9,
    },
    {
      atSeconds: 40,
      action: 'measure',
      description: 'Measuring stud bay with tape',
      toolLabel: 'tape measure',
      confidence: 0.8,
    },
    {
      atSeconds: 55,
      action: 'wait',
      description: 'Waiting for adhesive to cure',
      confidence: 0.95,
    },
    {
      atSeconds: 60,
      action: 'other',
      description: 'Unclear activity',
      confidence: 0.9,
    },
    {
      atSeconds: 70,
      action: 'fasten',
      description: '',
      confidence: 0.99,
    },
  ]);
  assert.equal(excludedForPrivacy, 0);
  assert.equal(clips.length, 2);
  assert.equal(clips[0]!.motion, 'cut');
  assert.equal(clips[0]!.startSec, 12);
  assert.equal(clips[0]!.endSec, 18);
  assert.equal(clips[0]!.durationInferred, false);
  assert.equal(clips[1]!.motion, 'measure');
  assert.equal(clips[1]!.durationInferred, true);
  assert.ok((clips[1]!.endSec as number) > (clips[1]!.startSec as number));
});

test('deriveMotionClips excludes privacy-overlapping segments', () => {
  const { clips, excludedForPrivacy } = deriveMotionClips(
    [
      {
        atSeconds: 10,
        endSeconds: 20,
        action: 'cut',
        description: 'Cutting trim',
        confidence: 0.9,
      },
      {
        atSeconds: 50,
        endSeconds: 60,
        action: 'measure',
        description: 'Measuring vanity',
        confidence: 0.9,
      },
    ],
    {
      privacyRanges: [{ startSec: 45, endSec: 70, reason: 'bathroom', confidence: 0.9, source: 'vision' }],
    },
  );
  assert.equal(clips.length, 1);
  assert.equal(clips[0]!.motion, 'cut');
  assert.equal(excludedForPrivacy, 1);
});

test('deriveMotionClips never invents from empty evidence', () => {
  const { clips } = deriveMotionClips([]);
  assert.deepEqual(clips, []);
  const low = deriveMotionClips([
    { atSeconds: 1, action: 'cut', description: 'Cutting', confidence: 0.1 },
  ]);
  assert.equal(low.clips.length, 0);
});

test('stored round-trip + public fields', () => {
  const derived = deriveMotionClips([
    {
      atSeconds: 5,
      endSeconds: 9,
      action: 'drill',
      description: 'Drilling pilot hole',
      confidence: 0.7,
    },
  ]);
  const stored = toStoredMotionClips(derived.clips, { excludedForPrivacy: 0, model: 'test' });
  assert.equal(stored.schema, MOTION_CLIPS_SCHEMA);
  const again = motionClipsFromStored(stored);
  assert.ok(again);
  assert.equal(again!.clips.length, 1);
  assert.equal(again!.clips[0]!.motion, 'drill');
  const pub = publicMotionClipsFields(again);
  assert.equal(pub?.count, 1);
});

test('motionClipsFromProofRow falls back to actions and respects privacy', () => {
  const stored = motionClipsFromProofRow({
    actions: [
      {
        atSeconds: 2,
        endSeconds: 6,
        action: 'screw',
        description: 'Screwing cabinet hinge',
        toolLabel: 'screwdriver',
        confidence: 0.88,
        source: 'ai_vision',
      },
    ],
    ai_findings: {
      privacyRedactions: {
        version: 1,
        ranges: [{ startSec: 0, endSec: 10, reason: 'bathroom', confidence: 0.9, source: 'heuristic' }],
      },
    },
  });
  assert.ok(stored);
  assert.equal(stored!.clips.length, 0);
  assert.equal(stored!.excludedForPrivacy, 1);
});

test('bucketMotionClipsByType groups and filters', () => {
  const items = [
    {
      startSec: 1,
      endSec: 3,
      action: 'cut' as const,
      motion: 'cut',
      description: 'a',
      toolLabel: null,
      objectLabel: null,
      materialLabel: null,
      room: null,
      confidence: 0.9,
      source: 'ai_vision' as const,
      durationInferred: false,
      proofId: 'p1',
      jobId: 'j1',
      orgId: 'o1',
      workDate: '2026-09-01',
      phase: 'during',
    },
    {
      startSec: 4,
      endSec: 6,
      action: 'fasten' as const,
      motion: 'screw',
      description: 'b',
      toolLabel: null,
      objectLabel: null,
      materialLabel: null,
      room: null,
      confidence: 0.9,
      source: 'ai_vision' as const,
      durationInferred: false,
      proofId: 'p2',
      jobId: 'j1',
      orgId: 'o1',
      workDate: '2026-09-01',
      phase: 'during',
    },
  ];
  const all = bucketMotionClipsByType(items);
  assert.equal(all.length, 2);
  const onlyScrew = bucketMotionClipsByType(items, { motion: 'screw' });
  assert.equal(onlyScrew.length, 1);
  assert.equal(onlyScrew[0]!.motion, 'screw');
});

test('listKnownMotionTypes includes screw/cut/measure', () => {
  const types = listKnownMotionTypes();
  const motions = new Set(types.map((t) => t.motion));
  assert.ok(motions.has('screw'));
  assert.ok(motions.has('cut'));
  assert.ok(motions.has('measure'));
});
