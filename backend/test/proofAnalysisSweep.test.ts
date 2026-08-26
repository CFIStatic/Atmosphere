import test from 'node:test';
import assert from 'node:assert/strict';
import { needsNarration, needsTranscript, sweepUnanalyzedProofs } from '../src/shared/proofAnalysisSweep.js';

test('needsNarration and needsTranscript treat idle and missing as unread', () => {
  assert.equal(needsNarration(null), true);
  assert.equal(needsNarration('idle'), true);
  assert.equal(needsNarration('done'), false);
  assert.equal(needsNarration('skipped', 'No model is configured.'), true);
  assert.equal(needsNarration('skipped', 'Could not extract frames from this recording.'), false);
  assert.equal(needsTranscript('queued'), false);
  assert.equal(needsTranscript(undefined), true);
});

test('sweepUnanalyzedProofs queues idle clips and leaves finished ones alone', async () => {
  const rows = [
    {
      id: 'old-1',
      org_id: 'org',
      job_id: 'job',
      party_id: 'party',
      phase: 'after',
      work_date: '2026-08-01',
      narration_status: 'idle',
      transcript_status: 'idle',
      storage_path: 'org/job/a.mp4',
    },
    {
      id: 'done-1',
      org_id: 'org',
      job_id: 'job',
      party_id: 'party',
      phase: 'after',
      work_date: '2026-08-02',
      narration_status: 'done',
      transcript_status: 'done',
      storage_path: 'org/job/b.mp4',
    },
  ];

  const admin = {
    from() {
      return {
        select() {
          return this;
        },
        is() {
          return this;
        },
        not() {
          return this;
        },
        or() {
          return this;
        },
        order() {
          return this;
        },
        limit: async () => ({ data: rows.filter((r) => r.narration_status === 'idle'), error: null }),
        update() {
          return { eq: async () => ({ error: null }) };
        },
      };
    },
  };

  const queued: { narration: string[]; transcript: string[] } = { narration: [], transcript: [] };
  const result = await sweepUnanalyzedProofs(admin, {
    limit: 10,
    queueNarrationFn: async (_admin, _party, proofId) => {
      queued.narration.push(proofId);
    },
    queueTranscriptFn: async (_admin, proofId) => {
      queued.transcript.push(proofId);
    },
  });
  assert.equal(result.narration, 1);
  assert.equal(result.transcript, 1);
  assert.deepEqual(queued.narration, ['old-1']);
  assert.deepEqual(queued.transcript, ['old-1']);
});
