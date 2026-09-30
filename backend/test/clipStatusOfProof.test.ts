import assert from 'node:assert/strict';
import test from 'node:test';
import { clipStatusOfProof } from '../src/shared/clipStatusOfProof.ts';

const FUTURE = new Date(Date.now() + 60_000).toISOString();
const PAST = new Date(Date.now() - 60_000).toISOString();

test('proof rows match the library mismatches seen in production', () => {
  // 62 live clips: analysis finished, ai_summary stored, no conversation stamp, no lease.
  assert.equal(
    clipStatusOfProof({
      state: 'analysed',
      analysis_status: 'done',
      narration_status: 'done',
      transcript_status: 'done',
      transcript_text: 'A short synthetic line.',
      summary_status: null,
      ai_summary: 'Synthetic walkthrough summary.',
      ai_findings: {},
    }).label,
    'Analyzed',
  );

  // One live clip: state stayed `checked` after the reading and the summary finished.
  assert.equal(
    clipStatusOfProof({
      state: 'checked',
      analysis_status: 'done',
      narration_status: 'done',
      transcript_status: 'done',
      transcript_text: 'A short synthetic line.',
      summary_status: 'done',
      summary_transcript_sha256: null,
      ai_summary: 'Synthetic walkthrough summary.',
      ai_findings: {
        conversation: { summary: 'Synthetic walkthrough summary.', transcriptSha256: 'unstamped' },
        evidenceLog: [{ text: 'Synthetic note.' }],
      },
    }).label,
    'Analyzed',
  );

  // Summary text is on the row, but the rebuild flag is stale and no lease is held.
  assert.equal(
    clipStatusOfProof({
      state: 'analysed',
      analysis_status: 'done',
      narration_status: 'done',
      transcript_status: 'done',
      transcript_text: 'A short synthetic line.',
      summary_status: 'stale',
      ai_summary: 'Synthetic walkthrough summary.',
      ai_findings: { conversation: { summary: 'Synthetic walkthrough summary.' } },
    }).label,
    'Analyzed',
  );

  // Running transcription whose worker lease expired must not stay Transcribing.
  assert.equal(
    clipStatusOfProof({
      state: 'analysed',
      analysis_status: 'done',
      transcript_status: 'running',
      transcript_lease_until: PAST,
      ai_summary: 'Synthetic walkthrough summary.',
      transcript_text: 'A short synthetic line.',
    }).label,
    'Analyzed',
  );

  assert.equal(
    clipStatusOfProof({
      transcript_status: 'running',
      transcript_lease_until: FUTURE,
      analysis_status: null,
    }).label,
    'Transcribing',
  );

  assert.equal(
    clipStatusOfProof({
      analysis_status: 'running',
      analysis_lease_until: FUTURE,
      analysis_error: 'The previous attempt timed out.',
    }).label,
    'Retrying',
  );

  assert.equal(
    clipStatusOfProof({
      analysis_status: 'failed',
      analysis_error: 'The previous attempt timed out.',
      analysis_lease_until: PAST,
    }).label,
    'Needs attention',
  );

  assert.equal(
    clipStatusOfProof({
      state: 'uploaded',
      transcript_status: 'skipped',
      transcript_error: 'No usable audio track on this clip.',
      transcript_text: null,
    }).label,
    'No speech',
  );

  assert.equal(clipStatusOfProof({ uploading: true, state: 'uploaded' }).label, 'Uploading');

  // Filed as checked. The worker's lease expired and nothing finished.
  assert.equal(
    clipStatusOfProof({
      state: 'checked',
      analysis_status: 'running',
      analysis_lease_until: PAST,
      narration_status: 'queued',
      narration_lease_until: PAST,
    }).label,
    'Recorded',
  );
  assert.equal(
    clipStatusOfProof({
      state: 'checked',
      analysis_status: 'running',
      analysis_lease_until: FUTURE,
    }).label,
    'Analyzing',
  );
  assert.equal(
    clipStatusOfProof({
      state: 'checked',
      analysis_status: 'failed',
      analysis_lease_until: PAST,
    }).label,
    'Needs attention',
  );

  // First summary, worker still holds the lease, nothing stored yet.
  assert.equal(
    clipStatusOfProof({
      state: 'analysed',
      analysis_status: 'done',
      transcript_status: 'done',
      transcript_text: 'A short synthetic line.',
      summary_status: 'running',
      summary_lease_until: FUTURE,
      ai_summary: null,
      ai_findings: {},
    }).label,
    'Summary still processing',
  );
});
