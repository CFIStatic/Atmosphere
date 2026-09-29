import assert from 'node:assert/strict';
import test from 'node:test';
import { clipProcessing } from '../src/shared/clipProcessing.ts';

test('one clip has one processing state on every surface', () => {
  assert.deepEqual(clipProcessing({ proofState: 'uploaded' }), {
    state: 'uploaded',
    label: 'Waiting to process',
    tone: 'neutral',
  });
  assert.equal(clipProcessing({ transcriptStatus: 'running' }).label, 'Transcribing');
  assert.equal(clipProcessing({ analysisStatus: 'queued', narrationStatus: 'running' }).label, 'Analyzing');
  assert.equal(clipProcessing({ proofState: 'checked' }).label, 'Analyzing');
  assert.equal(
    clipProcessing({ proofState: 'analysed', analysisStatus: 'done', summaryState: 'updating' }).label,
    'Summary still processing',
  );
  assert.equal(
    clipProcessing({ proofState: 'analysed', analysisStatus: 'done', summaryState: 'quarantined' }).state,
    'analyzing',
  );
  assert.equal(clipProcessing({ proofState: 'analysed', summaryState: 'fresh' }).label, 'Analyzed');
  assert.equal(clipProcessing({ analysisStatus: 'done', transcriptStatus: 'done' }).label, 'Analyzed');
  assert.equal(clipProcessing({ summaryState: 'failed', analysisStatus: 'done' }).label, 'Summary unavailable');
  assert.equal(clipProcessing({ analysisStatus: 'failed' }).label, 'Needs attention');
  assert.equal(clipProcessing({}).label, 'Recorded');
  assert.equal(clipProcessing({ failedChecks: 2 }).label, '2 checks failed');
});
