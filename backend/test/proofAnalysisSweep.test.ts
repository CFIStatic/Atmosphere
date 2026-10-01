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
  assert.equal(needsAnalysisReclaim('failed', 'Upstream timed out'), true);
  assert.equal(needsAnalysisReclaim(null), true);
  assert.equal(needsAnalysisReclaim('idle'), true);
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
      analysis_status: null,
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
      analysis_status: 'done',
      storage_path: 'org/job/b.mp4',
    },
  ];

  const admin = {
    from() {
      const self: any = {
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
        limit: async () => ({
          data: rows.filter((r) => r.narration_status === 'idle' || r.analysis_status == null),
          error: null,
        }),
        update() {
          return self;
        },
        eq() {
          return self;
        },
        maybeSingle: async () => ({ data: { id: 'old-1' }, error: null }),
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
  assert.equal(result.narration, 1);
  assert.equal(result.transcript, 1);
  assert.equal(result.analysis, 1);
  assert.deepEqual(queued.narration, ['old-1']);
  assert.deepEqual(queued.transcript, ['old-1']);
  assert.deepEqual(queued.analysis, ['old-1']);
});

function reclaimAdmin(rows: any[]) {
  return {
    from() {
      const self: any = {
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
        maybeSingle: async () => ({ data: { id: rows[0]?.id }, error: null }),
      };
      return self;
    },
  };
}

test('sweep requeues a failed day reading after a provider failure once', async () => {
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

  const queued: { narration: string[]; transcript: string[]; analysis: string[] } = {
    narration: [],
    transcript: [],
    analysis: [],
  };
  const result = await sweepUnanalyzedProofs(reclaimAdmin(rows), {
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

test('held clips do not fill the sweep batch ahead of another org', async () => {
  const held = Array.from({ length: 20 }, (_, index) => ({
    id: `held-${index}`,
    org_id: 'paused-org',
    job_id: 'job',
    party_id: 'party',
    phase: 'after',
    work_date: '2026-10-01',
    narration_status: 'idle',
    transcript_status: 'idle',
    analysis_status: 'idle',
    storage_path: `paused/${index}.mp4`,
    ai_budget_hold: true,
    received_at: `2026-10-01T00:${String(index).padStart(2, '0')}:00.000Z`,
  }));
  const other = {
    id: 'other-org-clip',
    org_id: 'other-org',
    job_id: 'job-2',
    party_id: 'party-2',
    phase: 'after',
    work_date: '2026-10-02',
    narration_status: 'idle',
    transcript_status: 'idle',
    analysis_status: 'idle',
    storage_path: 'other/clip.mp4',
    ai_budget_hold: false,
    received_at: '2026-10-02T00:00:00.000Z',
  };
  const rows = [...held, other];
  const filters: Array<[string, unknown]> = [];
  const admin = {
    from() {
      const self: any = {
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
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return self;
        },
        update() {
          return self;
        },
        limit: async (count: number) => {
          const excludesHeld = filters.some(([column, value]) => column === 'ai_budget_hold' && value === false);
          const visible = excludesHeld ? rows.filter((row) => row.ai_budget_hold === false) : rows;
          return { data: visible.slice(0, count), error: null };
        },
        maybeSingle: async () => ({ data: { id: 'other-org-clip' }, error: null }),
      };
      return self;
    },
  };
  const queued: string[] = [];
  const result = await sweepUnanalyzedProofs(admin, {
    limit: 20,
    isPaused: async () => false,
    queueNarrationFn: async (_admin, _party, proofId) => {
      queued.push(proofId);
    },
    queueTranscriptFn: async () => {},
    queueAnalysisFn: async () => {},
  });
  assert.equal(result.narration, 1);
  assert.deepEqual(queued, ['other-org-clip']);
});

test('the sweep rechecks the allowance before running AI on a clip whose hold was cleared', async () => {
  const updates: Array<Record<string, unknown>> = [];
  const rows = [
    {
      id: 'cleared-hold',
      org_id: 'paused-org',
      job_id: 'job',
      party_id: 'party',
      phase: 'after',
      work_date: '2026-10-01',
      narration_status: 'idle',
      transcript_status: 'idle',
      analysis_status: 'idle',
      storage_path: 'paused/cleared.mp4',
      ai_budget_hold: false,
    },
  ];
  const admin = {
    from() {
      const self: any = {
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
        eq() {
          return self;
        },
        update(payload: Record<string, unknown>) {
          updates.push(payload);
          return self;
        },
        limit: async () => ({ data: rows, error: null }),
        maybeSingle: async () => ({ data: { id: 'cleared-hold' }, error: null }),
      };
      return self;
    },
  };
  const queued: string[] = [];
  const result = await sweepUnanalyzedProofs(admin, {
    limit: 20,
    isPaused: async () => true,
    queueNarrationFn: async (_admin, _party, proofId) => {
      queued.push(proofId);
    },
    queueTranscriptFn: async (_admin, proofId) => {
      queued.push(proofId);
    },
    queueAnalysisFn: async (_admin, _party, _workDate, proofId) => {
      if (proofId) queued.push(proofId);
    },
  });
  assert.equal(result.narration, 0);
  assert.equal(result.transcript, 0);
  assert.equal(result.analysis, 0);
  assert.deepEqual(queued, []);
  assert.equal(updates.some((row) => row.ai_budget_hold === true), true);
});

test('sweep starts day reading for a filed clip that never left idle analysis', async () => {
  const rows = [
    {
      id: 'ios-fallback',
      org_id: 'org',
      job_id: 'job',
      party_id: 'party',
      phase: 'after',
      work_date: '2026-09-21',
      narration_status: 'done',
      transcript_status: 'done',
      analysis_status: null,
      analysis_error: null,
      storage_path: 'org/job/ios.mp4',
    },
  ];
  const queued: string[] = [];
  const result = await sweepUnanalyzedProofs(reclaimAdmin(rows), {
    limit: 10,
    queueNarrationFn: async () => {},
    queueTranscriptFn: async () => {},
    queueAnalysisFn: async (_admin, _party, _workDate, proofId) => {
      if (proofId) queued.push(proofId);
    },
  });
  assert.equal(result.analysis, 1);
  assert.deepEqual(queued, ['ios-fallback']);
});
