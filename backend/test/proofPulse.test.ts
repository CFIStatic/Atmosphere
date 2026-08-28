import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeProofPulse } from '../src/shared/proofPulse.js';

test('counts clips the assistant has read, is reading, and heard on the mic', () => {
  const pulse = summarizeProofPulse(
    [
      {
        analysisStatus: 'done',
        transcriptStatus: 'done',
        receivedAt: '2026-08-28T14:00:00Z',
        workDate: '2026-08-28',
      },
      {
        analysisStatus: 'queued',
        transcriptStatus: 'queued',
        receivedAt: '2026-08-28T15:00:00Z',
        workDate: '2026-08-28',
      },
      {
        analysisStatus: 'failed',
        transcriptStatus: null,
        receivedAt: '2026-08-20T12:00:00Z',
        workDate: '2026-08-20',
      },
      {
        analysisStatus: null,
        transcriptStatus: null,
        receivedAt: '2026-08-19T12:00:00Z',
        workDate: '2026-08-19',
      },
    ],
    new Date('2026-08-28T18:00:00Z'),
  );

  assert.equal(pulse.clips, 4);
  assert.equal(pulse.read, 1);
  assert.equal(pulse.analysing, 1);
  assert.equal(pulse.failed, 1);
  assert.equal(pulse.unread, 1);
  assert.equal(pulse.heard, 1);
  assert.equal(pulse.filmedToday, 2);
});
