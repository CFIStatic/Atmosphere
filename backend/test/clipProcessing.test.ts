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
  assert.equal(clipProcessing({ uploading: true, analysisStatus: 'done' }).label, 'Uploading');
});

test('library mismatches: a finished clip is not stuck on summary or Recorded', () => {
  // Production: proof left at `checked` after analysis and a fresh summary.
  assert.equal(
    clipProcessing({
      proofState: 'checked',
      analysisStatus: 'done',
      narrationStatus: 'done',
      transcriptStatus: 'done',
      summaryState: 'fresh',
      hasSummary: true,
      summaryActive: false,
    }).label,
    'Analyzed',
  );
  // Production: analysed, ai_summary stored, conversation summary never stamped (summaryState none).
  assert.equal(
    clipProcessing({
      proofState: 'analysed',
      analysisStatus: 'done',
      narrationStatus: 'done',
      transcriptStatus: 'done',
      summaryState: 'none',
      hasSummary: true,
      summaryActive: false,
    }).label,
    'Analyzed',
  );
  // A saved summary must not read as still processing, even while a rebuild is flagged.
  assert.equal(
    clipProcessing({
      proofState: 'analysed',
      analysisStatus: 'done',
      summaryState: 'updating',
      hasSummary: true,
      summaryActive: true,
    }).label,
    'Analyzed',
  );
  assert.equal(
    clipProcessing({
      proofState: 'analysed',
      analysisStatus: 'done',
      summaryState: 'quarantined',
      hasSummary: true,
    }).label,
    'Analyzed',
  );
  // Stale queued/running with no live lease is not processing forever.
  assert.equal(
    clipProcessing({
      analysisStatus: 'done',
      transcriptStatus: 'running',
      transcriptActive: false,
      summaryState: 'updating',
      hasSummary: true,
      summaryActive: false,
    }).label,
    'Analyzed',
  );
  assert.equal(
    clipProcessing({
      proofState: 'uploaded',
      analysisStatus: 'queued',
      analysisActive: false,
      transcriptStatus: 'queued',
      transcriptActive: false,
    }).label,
    'Waiting to process',
  );
  // Production default: filed as checked, then vision sits queued/running after the lease dies.
  assert.equal(
    clipProcessing({
      proofState: 'checked',
      analysisStatus: 'queued',
      analysisActive: false,
      narrationStatus: 'running',
      narrationActive: false,
    }).label,
    'Recorded',
  );
  assert.equal(
    clipProcessing({
      proofState: 'checked',
      analysisStatus: 'running',
      analysisActive: false,
      narrationActive: false,
    }).label,
    'Recorded',
  );
  assert.equal(
    clipProcessing({
      proofState: 'checked',
      analysisStatus: 'queued',
      analysisActive: true,
    }).label,
    'Analyzing',
  );
  // No speech is done, not Recorded.
  assert.equal(
    clipProcessing({
      transcriptStatus: 'skipped',
      noSpeech: true,
      proofState: 'uploaded',
    }).label,
    'No speech',
  );
  assert.equal(
    clipProcessing({
      transcriptStatus: 'skipped',
      noSpeech: true,
      analysisStatus: 'done',
      hasSummary: true,
    }).label,
    'Analyzed',
  );
  // A live retry names itself. A dead failure does not pretend to be running.
  assert.equal(
    clipProcessing({
      analysisStatus: 'running',
      analysisActive: true,
      retrying: true,
    }).label,
    'Retrying',
  );
  assert.equal(clipProcessing({ analysisStatus: 'failed', retrying: false }).label, 'Needs attention');
  // A new clip is filed as checked. An expired lease is not Analyzing forever.
  assert.equal(
    clipProcessing({
      proofState: 'checked',
      analysisStatus: 'running',
      analysisActive: false,
      narrationStatus: 'queued',
      narrationActive: false,
    }).label,
    'Recorded',
  );
  assert.equal(
    clipProcessing({
      proofState: 'checked',
      analysisStatus: 'running',
      analysisActive: false,
      narrationActive: false,
      retrying: true,
    }).label,
    'Recorded',
  );
  assert.equal(
    clipProcessing({
      proofState: 'checked',
      analysisStatus: 'running',
      analysisActive: true,
    }).label,
    'Analyzing',
  );
  assert.equal(
    clipProcessing({
      proofState: 'checked',
      analysisStatus: 'failed',
      analysisActive: false,
      narrationActive: false,
    }).label,
    'Needs attention',
  );
  assert.equal(
    clipProcessing({
      summaryState: 'updating',
      summaryActive: false,
      analysisStatus: 'done',
      hasSummary: false,
    }).label,
    'Analyzed',
  );
});
