import test from 'node:test';
import assert from 'node:assert/strict';
import {
  needsAnalysisReclaim,
  needsNarration,
  needsTranscript,
  sweepUnanalyzedProofs,
} from '../src/shared/proofAnalysisSweep.js';

test('needsNarration and needsTranscript treat idle and missing as unread', () => {
  assert.equal(needsNarration(null), true);
  assert.equal(needsNarration('idle'), true);
  assert.equal(needsNarration('done'), false);
  assert.equal(needsNarration('skipped', 'No model is configured.'), true);
  assert.equal(needsNarration('skipped', 'Could not extract frames from this recording.'), true);
  assert.equal(needsNarration('failed', 'The model reply was not usable.'), true);
  assert.equal(needsNarration('queued'), true);
  assert.equal(needsNarration('running'), true);
  assert.equal(needsTranscript('queued'), true);
  assert.equal(needsTranscript('failed'), true);
  assert.equal(needsTranscript(undefined), true);
  assert.equal(needsAnalysisReclaim('queued'), true);
  assert.equal(needsAnalysisReclaim('running'), true);
  assert.equal(
    needsAnalysisReclaim('failed', '404 model: claude-opus-4-1-20250805'),
    true,
  );
  assert.equal(needsAnalysisReclaim('failed', 'Upstream timed out'), false);
  assert.equal(needsAnalysisReclaim(null), false);
  assert.equal(needsAnalysisReclaim('done'), false);
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

  const queued: { narration: string[]; transcript: string[]; analysis: string[] } = {
    narration: [],
    transcript: [],
    analysis: [],
  };
  const result = await sweepUnanalyzedProofs(admin, {
    limit: 10,
    queueNarrationFn: async (_admin, _party, proofId) => {
      queued.narration.push(proofId);
    },
    queueTranscriptFn: async (_admin, proofId) => {
      queued.transcript.push(proofId);
    },
    queueAnalysisFn: async (_admin, _party, _workDate, proofId) => {
      if (proofId) queued.analysis.push(proofId);
    },
  });
  assert.equal(result.narration, 1);
  assert.equal(result.transcript, 1);
  assert.equal(result.analysis, 0);
  assert.deepEqual(queued.narration, ['old-1']);
  assert.deepEqual(queued.transcript, ['old-1']);
});

test('sweep requeues a failed day reading killed by a retired Anthropic pin once', async () => {
  const rows = [
    {
      id: 'tiffany',
      org_id: 'org',
      job_id: 'job',
      party_id: 'party',
      phase: 'after',
      work_date: '2026-09-21',
      narration_status: 'done',
      transcript_status: 'done',
      analysis_status: 'failed',
      analysis_error:
        '404 {"type":"error","error":{"type":"not_found_error","message":"model: claude-opus-4-1-20250805"}}',
      storage_path: 'org/job/tiffany.webm',
    },
  ];

  const admin = {
    from() {
      const self = {
        select() {
          return self;
        },
        is() {
          return self;
        },
        not() {
          return self;
        },
        or() {
          return self;
        },
        order() {
          return self;
        },
        limit: async () => ({ data: rows, error: null }),
        update() {
          return self;
        },
        eq() {
          return self;
        },
        maybeSingle: async () => ({ data: { id: 'tiffany' }, error: null }),
      };
      return self;
    },
  };

  const queued: { narration: string[]; transcript: string[]; analysis: string[] } = {
    narration: [],
    transcript: [],
    analysis: [],
  };
  const result = await sweepUnanalyzedProofs(admin, {
    limit: 10,
    queueNarrationFn: async (_admin, _party, proofId) => {
      queued.narration.push(proofId);
    },
    queueTranscriptFn: async (_admin, proofId) => {
      queued.transcript.push(proofId);
    },
    queueAnalysisFn: async (_admin, _party, _workDate, proofId) => {
      if (proofId) queued.analysis.push(proofId);
    },
  });
  assert.equal(result.analysis, 1);
  assert.deepEqual(queued.analysis, ['tiffany']);
  assert.deepEqual(queued.narration, []);
  assert.deepEqual(queued.transcript, []);
});
