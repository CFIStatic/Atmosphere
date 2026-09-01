import test from 'node:test';
import assert from 'node:assert/strict';
import { analyseUploadedProof } from '../src/routes/proofOfWork.js';

/**
 * The filing contract: a stored video is read without anyone opening it.
 */
test('analyseUploadedProof always starts vision, day reading, and speech', async () => {
  const started: string[] = [];
  const result = await analyseUploadedProof(
    {},
    { org_id: 'org-1', job_id: 'job-1', id: 'party-1', trade: 'water' },
    { id: 'proof-1', phase: 'after' },
    '2026-08-31',
    {
      queueNarrationFn: async (_admin, party, proofId, phase, workDate) => {
        started.push(`narration:${proofId}:${phase}:${workDate}:${party.id}`);
      },
      queueDayAnalysisFn: async (_admin, party, workDate, proofId) => {
        started.push(`day:${proofId}:${workDate}:${party.id}`);
        return 'queued';
      },
      queueTranscriptFn: async (_admin, proofId) => {
        started.push(`transcript:${proofId}`);
      },
    },
  );

  assert.equal(result, 'queued');
  assert.deepEqual(started, [
    'narration:proof-1:after:2026-08-31:party-1',
    'day:proof-1:2026-08-31:party-1',
    'transcript:proof-1',
  ]);
});

test('recordProof calls analyseUploadedProof after the file is stored', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/routes/proofOfWork.ts', import.meta.url), 'utf8');
  assert.match(src, /const analysis = await analyseUploadedProof\(/);
  const fileIndex = src.indexOf('if (error) throw new HttpError(400, error.message, \'proof_failed\')');
  const analyseIndex = src.indexOf('await analyseUploadedProof');
  assert.ok(fileIndex > 0 && analyseIndex > fileIndex, 'analysis must start after the row is stored');
});

test('recordProof stores client frames off the critical path', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/routes/proofOfWork.ts', import.meta.url), 'utf8');
  const framesIdx = src.indexOf('void storeClientFrames(');
  const analyseIdx = src.indexOf('await analyseUploadedProof(');
  assert.ok(framesIdx > 0, 'client frames must be fired without awaiting');
  assert.ok(analyseIdx > framesIdx, 'analysis still starts after the proof row exists');
  assert.match(src, /async function storeClientFrames\(/);
});

