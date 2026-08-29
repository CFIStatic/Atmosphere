import test from 'node:test';
import assert from 'node:assert/strict';
import {
  descriptionFindings,
  preparedFromProofFrames,
  scopeContextNote,
} from '../src/shared/workerActivityAnalysis.js';

test('scopeContextNote asks for cross-reference when scope lines exist', () => {
  const note = scopeContextNote(['Extract standing water', 'Set air movers']);
  assert.match(note, /Cross-reference/i);
  assert.match(note, /Extract standing water/);
  assert.match(note, /Set air movers/);
  assert.doesNotMatch(note, /No job scope/i);
});

test('scopeContextNote asks for a description when scope is empty', () => {
  const note = scopeContextNote([]);
  assert.match(note, /No job scope/i);
  assert.match(note, /dense timestamped reading/i);
});

test('preparedFromProofFrames wraps base64 stills for dictation', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const prepared = preparedFromProofFrames({
    proofId: 'proof-1',
    durationSeconds: 120,
    longForm: false,
    frames: [{ atSeconds: 0, base64: jpeg.toString('base64') }],
  });
  assert.equal(prepared.id, 'proof-1');
  assert.equal(prepared.source, 'proof_of_work');
  assert.equal(prepared.frames.length, 1);
  assert.deepEqual(prepared.frames[0].jpeg, jpeg);
});

test('descriptionFindings marks analysis as description-only (no scope cross-ref)', () => {
  const findings = descriptionFindings({
    narrationText: 'Worker removed wet drywall along the south wall.',
    narrationSummary: 'Drywall removal visible.',
    model: 'test-model',
    frameCount: 8,
    actions: [],
    entries: [{ atSeconds: 12, text: 'South wall opened; wet paper facing, brown at the cut.' }],
    cannotTell: ['Whether the cavity is dry behind the studs.'],
  });
  assert.equal(findings.scopeCrossRef, false);
  assert.equal(findings.kind, 'day_film');
  assert.deepEqual(findings.scopeVerdicts, []);
  assert.equal(findings.summary, 'Worker removed wet drywall along the south wall.');
  assert.deepEqual(findings.cannotTell, ['Whether the cavity is dry behind the studs.']);
  assert.equal((findings.timeline as Array<{ summary: string }>)[0]?.summary, 'South wall opened; wet paper facing, brown at the cut.');
});
