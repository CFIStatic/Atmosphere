import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROOF_ASSEMBLE_MAX_BYTES,
  PROOF_CHUNK_SIZE,
  assertProofAssembleBudget,
  chooseProofChunkSize,
  libraryJobCaptureStatus,
  missingPartIndexes,
  nextUploadBackoffMs,
  partByteRange,
  partObjectPath,
  planProofChunks,
  storageObjectByteSize,
} from '../src/lib/proofUploadChunks.js';

test('small clips stay a single PUT so a 20-second take is one round trip', () => {
  const plan = planProofChunks(2_000_000);
  assert.equal(plan.chunkCount, 1);
  assert.equal(plan.multipart, false);
  assert.deepEqual(plan.offsets, [0]);
});

test('a 40 MB film splits into 8 MB parts the phone can resume', () => {
  const plan = planProofChunks(40 * 1024 * 1024);
  assert.equal(plan.chunkSize, PROOF_CHUNK_SIZE);
  assert.equal(plan.chunkCount, 5);
  assert.equal(plan.multipart, true);
  assert.equal(plan.offsets[0], 0);
  assert.equal(plan.offsets[4], 32 * 1024 * 1024);
  assert.deepEqual(partByteRange(plan.byteSize, plan.chunkSize, 4), {
    start: 32 * 1024 * 1024,
    end: 40 * 1024 * 1024 - 1,
  });
});

test('day-length files use larger slices; over the assemble cap stays one PUT', () => {
  assert.equal(chooseProofChunkSize(80 * 1024 * 1024), 16 * 1024 * 1024);
  assert.equal(chooseProofChunkSize(300 * 1024 * 1024), 32 * 1024 * 1024);
  const huge = planProofChunks(PROOF_ASSEMBLE_MAX_BYTES + 1);
  assert.equal(huge.multipart, false);
});

test('part paths stay under the final object so a leaked part cannot retarget a job', () => {
  assert.equal(
    partObjectPath('org/job/party/2026-09-05-after.webm', 3),
    'org/job/party/2026-09-05-after.webm.parts/0003',
  );
  assert.throws(() => partObjectPath('x', -1));
});

test('resume skips parts that already landed', () => {
  assert.deepEqual(missingPartIndexes([0, 2], 4), [1, 3]);
  assert.deepEqual(missingPartIndexes([], 2), [0, 1]);
  assert.deepEqual(missingPartIndexes([0, 1], 2), []);
});

test('backoff grows then caps so a dead tower is not hammered', () => {
  assert.equal(nextUploadBackoffMs(0), 400);
  assert.equal(nextUploadBackoffMs(1), 800);
  assert.equal(nextUploadBackoffMs(2), 1600);
  assert.equal(nextUploadBackoffMs(8), 5000);
});

test('a job with no clip yet is in progress on the office list', () => {
  assert.equal(libraryJobCaptureStatus(false), 'in_progress');
  assert.equal(libraryJobCaptureStatus(true), 'recorded');
});

test('assemble budget rejects before the next part is kept', () => {
  assert.equal(assertProofAssembleBudget(0, 100, 512), 100);
  assert.equal(assertProofAssembleBudget(400, 112, 512), 512);
  assert.throws(() => assertProofAssembleBudget(400, 113, 512), /too large/);
  assert.throws(() => assertProofAssembleBudget(0, PROOF_ASSEMBLE_MAX_BYTES + 1));
  assert.equal(storageObjectByteSize(Buffer.from('abcd')), 4);
  assert.equal(storageObjectByteSize({ size: 99 }), 99);
  assert.equal(storageObjectByteSize({}), null);
});
