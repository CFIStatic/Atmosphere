import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeProofPulse } from '../src/shared/proofPulse.js';

const NOW = new Date('2026-08-28T18:00:00Z');

test('counts clips the assistant has read, is reading, and heard on the mic', () => {
  const pulse = summarizeProofPulse(
    [
      {
        jobId: 'job-a',
        analysisStatus: 'done',
        transcriptStatus: 'done',
        receivedAt: '2026-08-28T14:00:00Z',
        workDate: '2026-08-28',
      },
      {
        jobId: 'job-a',
        analysisStatus: 'queued',
        transcriptStatus: 'queued',
        receivedAt: '2026-08-28T15:00:00Z',
        workDate: '2026-08-28',
      },
      {
        jobId: 'job-b',
        analysisStatus: 'failed',
        transcriptStatus: null,
        receivedAt: '2026-08-20T12:00:00Z',
        workDate: '2026-08-20',
      },
      {
        jobId: 'job-b',
        analysisStatus: null,
        transcriptStatus: null,
        receivedAt: '2026-08-19T12:00:00Z',
        workDate: '2026-08-19',
      },
    ],
    NOW,
  );

  assert.equal(pulse.clips, 4);
  assert.equal(pulse.read, 1);
  assert.equal(pulse.analysing, 1);
  assert.equal(pulse.failed, 1);
  assert.equal(pulse.unread, 1);
  assert.equal(pulse.heard, 1);
  assert.equal(pulse.filmedToday, 2);
  assert.deepEqual(
    pulse.byJob.map((row) => row.jobId),
    ['job-b', 'job-a'],
  );
  assert.equal(pulse.byJob[0].failed, 1);
  assert.equal(pulse.byJob[0].unread, 1);
  assert.equal(pulse.byJob[1].read, 1);
  assert.equal(pulse.byJob[1].analysing, 1);
  assert.equal(pulse.byJob[1].filmedToday, 2);
});

test('clips without a job still count in the totals', () => {
  const pulse = summarizeProofPulse(
    [
      {
        analysisStatus: 'done',
        transcriptStatus: null,
        receivedAt: '2026-08-20T12:00:00Z',
        workDate: '2026-08-20',
      },
    ],
    NOW,
  );
  assert.equal(pulse.clips, 1);
  assert.equal(pulse.read, 1);
  assert.deepEqual(pulse.byJob, []);
});
