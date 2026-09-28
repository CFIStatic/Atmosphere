/* eslint-disable @typescript-eslint/no-explicit-any */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  staleSummaryPatch,
  summaryStateOf,
  transcriptSha256,
} from '../src/audio/summaryFreshness.ts';
import { summaryClaimContradictions } from '../src/audio/summaryValidation.ts';
import {
  createSummaryQueue,
  refreshProofSummary,
  queueSummaryRefresh,
  sweepStaleSummaries,
  TranscriptMovedError,
} from '../src/audio/summaryQueue.ts';
import { backfillStaleSummaries, staleSummaryReason } from '../src/lib/backfillStaleSummaries.ts';
import { normalizeAnalysisTimeline } from '../src/shared/analysisTimeline.ts';

/*
 * Synthetic stand-in for the incident: a 44-second walkthrough re-transcribed
 * to five lines while its stored AI summary still described the old one-line
 * transcript. No real clip content is committed (public repo).
 */
const FIVE_LINES = [
  '[0:00] first short line.',
  '[0:11] second line about the room.',
  '[0:30] third line.',
  '[0:35] fourth line here.',
  '[0:38] fifth line.',
].join('\n');
const STALE_CONVERSATION = {
  version: 2,
  source: 'llm',
  executiveSummary:
    'This clip is a walkthrough. The only speech captured in the entire recording is a single context-free fragment, "First short line."',
  summary: 'Walkthrough with only one stray spoken fragment.',
  details: ['Audio content: exactly one spoken fragment in 44 seconds.'],
  turns: [{ tSec: null, speakerLabel: 'Speaker A', text: 'First short line.' }],
};

/** Minimal Supabase stand-in: records updates, answers selects from `rows`. */
function fakeAdmin(rows: Array<Record<string, unknown>>) {
  const updates: Array<{ id: unknown; patch: Record<string, unknown>; filters: Array<[string, unknown]> }> = [];
  const builder = (mode: 'select' | 'update', patch?: Record<string, unknown>) => {
    const filters: Array<[string, unknown]> = [];
    let range: [number, number] | null = null;
    const matches = () =>
      rows.filter((row) =>
        filters.every(([col, val]) =>
          col === '$in' ? true : col.startsWith('is:') ? (row[col.slice(3)] ?? null) === val : row[col] === val,
        ),
      );
    const api: any = {
      select: () => api,
      eq: (col: string, val: unknown) => (filters.push([col, val]), api),
      is: (col: string, val: unknown) => (filters.push([`is:${col}`, val]), api),
      in: (col: string, vals: unknown[]) => {
        filters.push(['$in', null]);
        const keep = new Set(vals);
        const orig = matches;
        void orig;
        (api as any)._in = { col, keep };
        return api;
      },
      order: () => api,
      limit: () => api,
      range: (a: number, b: number) => ((range = [a, b]), api),
      maybeSingle: async () => {
        const found = matches()[0] ?? null;
        if (mode === 'update') {
          if (found) {
            Object.assign(found, patch);
            updates.push({ id: found.id, patch: patch!, filters: [...filters] });
          }
          return { data: found ? { id: found.id } : null, error: null };
        }
        return { data: found, error: null };
      },
      then: (resolve: (v: unknown) => void) => {
        let list = matches();
        const inFilter = (api as any)._in as { col: string; keep: Set<unknown> } | undefined;
        if (inFilter) list = list.filter((row) => inFilter.keep.has(row[inFilter.col]));
        if (mode === 'update') {
          for (const row of list) {
            Object.assign(row, patch);
            updates.push({ id: row.id, patch: patch!, filters: [...filters] });
          }
          resolve({ data: null, error: null });
          return;
        }
        if (range) list = list.slice(range[0], range[1] + 1);
        resolve({ data: list, error: null });
      },
    };
    return api;
  };
  return {
    updates,
    rows,
    from: () => ({
      select: () => builder('select'),
      update: (patch: Record<string, unknown>) => builder('update', patch),
    }),
  };
}

test('a stale "only one fragment" summary is caught against a five-line transcript', () => {
  const problems = summaryClaimContradictions(STALE_CONVERSATION, FIVE_LINES);
  assert.ok(problems.length >= 2, problems.join('\n'));
  assert.ok(problems.every((p) => /transcript has 5 lines/.test(p)));
  assert.deepEqual(
    summaryClaimContradictions({ executiveSummary: 'Five short lines are spoken during the walkthrough.' }, FIVE_LINES),
    [],
  );
  assert.deepEqual(summaryClaimContradictions({ summary: 'No speech; the room is silent.' }, ''), []);
  assert.equal(summaryClaimContradictions({ summary: 'There is no conversation at all.' }, FIVE_LINES).length, 0,
    '"no conversation" alone is not a count claim; "no speech" is');
  assert.equal(summaryClaimContradictions({ summary: 'No speech was recorded.' }, FIVE_LINES).length, 1);
});

test('summary state: hash mismatch and pending statuses read as updating', () => {
  const fresh = {
    transcript_text: FIVE_LINES,
    summary_transcript_sha256: transcriptSha256(FIVE_LINES),
    summary_status: 'done',
    ai_findings: { conversation: {} },
  };
  assert.equal(summaryStateOf(fresh), 'fresh');
  assert.equal(summaryStateOf({ ...fresh, summary_transcript_sha256: transcriptSha256('[0:00] old line.') }), 'updating');
  assert.equal(summaryStateOf({ ...fresh, summary_status: 'stale' }), 'updating');
  assert.equal(summaryStateOf({ ...fresh, summary_status: 'queued' }), 'updating');
  // Quarantine stamps a matching hash (and usually an evidence log) before give-up.
  assert.equal(summaryStateOf({ ...fresh, summary_status: 'failed' }), 'failed');
  assert.equal(
    summaryStateOf({ ...fresh, summary_status: 'failed', ai_findings: { evidenceLog: [{ text: 'kept' }] } }),
    'failed',
  );
  assert.equal(summaryStateOf({ transcript_text: FIVE_LINES, summary_status: 'failed', ai_findings: {} }), 'failed');
  assert.equal(summaryStateOf({ transcript_text: FIVE_LINES, ai_findings: {} }), 'none');
  assert.deepEqual(staleSummaryPatch(), { summary_status: 'stale', summary_error: null });
});

test('refreshProofSummary marks done only when the summary read the live transcript', async () => {
  const admin = fakeAdmin([{ id: 'p1', transcript_text: FIVE_LINES, summary_transcript_sha256: null }]);
  await refreshProofSummary(admin, 'p1', {
    enrich: async () => {
      admin.rows[0]!.summary_transcript_sha256 = transcriptSha256(FIVE_LINES);
    },
  });
  assert.equal(admin.rows[0]!.summary_status, 'done');

  const moved = fakeAdmin([{ id: 'p2', transcript_text: FIVE_LINES, summary_transcript_sha256: null }]);
  await assert.rejects(
    refreshProofSummary(moved, 'p2', {
      enrich: async () => {
        moved.rows[0]!.summary_transcript_sha256 = transcriptSha256('[0:00] older text.');
      },
    }),
    TranscriptMovedError,
  );
  assert.equal(moved.rows[0]!.summary_status, 'running');
});

test('refreshProofSummary does not stamp done over a transcript that moved after the hash check', async () => {
  const row: Record<string, unknown> = {
    id: 'p3',
    transcript_text: FIVE_LINES,
    summary_transcript_sha256: null,
    summary_status: 'stale',
  };
  const admin = fakeAdmin([row]);
  const realFrom = admin.from;
  let reads = 0;
  admin.from = () => {
    const query = realFrom();
    const realSelect = query.select;
    query.select = (...args: unknown[]) => {
      const selected = realSelect(...args);
      const realMaybe = selected.maybeSingle.bind(selected);
      selected.maybeSingle = async () => {
        const result = await realMaybe();
        reads += 1;
        if (reads === 1 && result.data) {
          const snapshot = { ...result.data };
          row.summary_status = 'stale';
          row.transcript_text = `${FIVE_LINES}\n[0:40] a newer line.`;
          return { ...result, data: snapshot };
        }
        return result;
      };
      return selected;
    };
    return query;
  };

  await assert.rejects(
    refreshProofSummary(admin, 'p3', {
      enrich: async () => {
        row.summary_transcript_sha256 = transcriptSha256(FIVE_LINES);
      },
    }),
    TranscriptMovedError,
  );
  assert.equal(row.summary_status, 'stale');
  assert.notEqual(row.summary_transcript_sha256, transcriptSha256(String(row.transcript_text)));
});

async function settle(queue: { pending: number }): Promise<void> {
  for (let i = 0; i < 50 && queue.pending; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

test('giving up marks failed only while this rebuild still owns the row', async () => {
  const owned = {
    id: 'p5',
    summary_status: 'queued' as string | null,
    summary_error: null as string | null,
    summary_lease_until: 'lease' as string | null,
  };
  const ownedAdmin = fakeAdmin([owned]);
  const ownedQueue = createSummaryQueue({
    getAdmin: async () => ownedAdmin,
    deps: { enrich: async () => { throw new Error('model down'); } },
    delaysMs: [],
    sleep: async () => {},
  });
  ownedQueue.enqueue({ key: 'summary:p5', proofId: 'p5' });
  await settle(ownedQueue);
  assert.equal(ownedQueue.pending, 0);
  assert.equal(owned.summary_status, 'failed');
  assert.equal(owned.summary_error, 'model down');
  assert.equal(owned.summary_lease_until, null);

  const moved = { id: 'p4', summary_status: 'queued' as string | null, summary_error: null as string | null };
  const movedAdmin = fakeAdmin([moved]);
  const movedQueue = createSummaryQueue({
    getAdmin: async () => movedAdmin,
    deps: {
      enrich: async () => {
        moved.summary_status = 'queued';
        throw new Error('model down');
      },
    },
    delaysMs: [],
    sleep: async () => {},
  });
  movedQueue.enqueue({ key: 'summary:p4', proofId: 'p4' });
  await settle(movedQueue);
  assert.equal(movedQueue.pending, 0);
  assert.equal(moved.summary_status, 'queued');
  assert.equal(moved.summary_error, null);
});

test('queueSummaryRefresh enqueues only where workers run and never throws', async () => {
  const admin = fakeAdmin([{ id: 'p1', summary_status: 'stale' }]);
  const jobs: string[] = [];
  assert.equal(await queueSummaryRefresh(admin, 'p1', { runWorkers: false, enqueue: (j) => (jobs.push(j.proofId), true) }), false);
  assert.equal(admin.rows[0]!.summary_status, 'stale');
  assert.equal(await queueSummaryRefresh(admin, 'p1', { runWorkers: true, enqueue: (j) => (jobs.push(j.proofId), true) }), true);
  assert.equal(admin.rows[0]!.summary_status, 'queued');
  assert.deepEqual(jobs, ['p1']);
  const broken = { from: () => { throw new Error('down'); } };
  assert.equal(await queueSummaryRefresh(broken, 'p1', { runWorkers: true }), false);
});

test('sweep re-queues stale rows and running rows whose lease ran out', async () => {
  const now = new Date('2026-09-28T22:00:00Z');
  const admin = fakeAdmin([
    { id: 'a', summary_status: 'stale', deleted_at: null },
    { id: 'b', summary_status: 'running', summary_lease_until: '2026-09-28T23:00:00Z', deleted_at: null },
    { id: 'c', summary_status: 'running', summary_lease_until: '2026-09-28T21:00:00Z', deleted_at: null },
    { id: 'd', summary_status: 'done', deleted_at: null },
  ]);
  const jobs: string[] = [];
  const n = await sweepStaleSummaries(admin, { now, enqueue: (j) => (jobs.push(j.proofId), true) });
  assert.equal(n, 2);
  assert.deepEqual(jobs.sort(), ['a', 'c']);
});

test('backfill flags a contradicting summary first, and is a dry run by default', async () => {
  const drifted = {
    id: 'drift',
    transcript_text: FIVE_LINES,
    transcript_status: 'done',
    transcribed_at: '2026-09-27T19:55:35Z',
    narrated_at: '2026-09-22T01:16:00Z',
    summary_status: null,
    ai_findings: { conversation: STALE_CONVERSATION },
    deleted_at: null,
  };
  assert.equal(staleSummaryReason(drifted), 'summary_contradiction');
  assert.equal(
    staleSummaryReason({ ...drifted, ai_findings: { conversation: { executiveSummary: 'A walkthrough.' } } }),
    'transcript_newer',
  );
  assert.equal(
    staleSummaryReason({
      ...drifted,
      summary_transcript_sha256: transcriptSha256('[0:00] old.'),
      ai_findings: { conversation: { executiveSummary: 'A walkthrough.' } },
    }),
    'hash_mismatch',
  );
  assert.equal(
    staleSummaryReason({ id: 'tl', ai_findings: { timeline: [{ atSeconds: 1, summary: 'x' }] } }),
    'untimed_timeline',
  );
  assert.equal(staleSummaryReason({ ...drifted, summary_status: 'queued' }), null);
  const fresh = {
    ...drifted,
    id: 'fresh',
    summary_status: 'done',
    summary_transcript_sha256: transcriptSha256(FIVE_LINES),
    ai_findings: { conversation: { executiveSummary: 'Five short lines.' } },
  };
  assert.equal(staleSummaryReason(fresh), null);

  const admin = fakeAdmin([{ ...drifted }, { ...fresh }]);
  const dry = await backfillStaleSummaries(admin as never);
  assert.equal(dry.apply, false);
  assert.equal(dry.checked, 2);
  assert.deepEqual(dry.affected, [{ id: 'drift', reason: 'summary_contradiction' }]);
  assert.equal(admin.updates.length, 0, 'a dry run writes nothing');

  const applied = await backfillStaleSummaries(admin as never, { apply: true });
  assert.equal(applied.marked, 1);
  assert.equal(admin.rows[0]!.summary_status, 'stale');
  assert.equal(admin.rows[1]!.summary_status, 'done');
});

test('timeline rows keep their own time; untimed and repeated beats are dropped', () => {
  const beats = [
    { atSeconds: 0.5, text: 'Camera holds on the ceiling light.' },
    { atSeconds: 4.52, text: 'Pan reveals the clock wall.' },
  ];
  const rows = normalizeAnalysisTimeline(
    [
      { atSeconds: 0.5, summary: 'Camera holds on the ceiling light.' },
      { atSeconds: 4.6, summary: 'Pan reveals the clock wall.' },
      { summary: 'A long description of the whole clip with no time.' },
      { startSeconds: 20, summary: 'Person leans over the table.' },
    ],
    beats,
  );
  assert.deepEqual(
    rows.map((r: { startSeconds?: number | null; summary?: string | null }) => [r.startSeconds, r.summary]),
    [[20, 'Person leans over the table.']],
  );
});

test('the library hides a contradicting summary and marks it quarantined', async () => {
  const { serializeEvidence } = await import('../src/verifier/library.ts');
  const proof = {
    id: 'p-drift',
    job_id: 'j1',
    org_id: 'o1',
    phase: 'after',
    work_date: '2026-09-21',
    duration_seconds: 44,
    analysis_status: 'done',
    narration_status: 'done',
    narration_text: 'Handheld walkthrough of a furnished interior.',
    ai_summary: 'A short handheld interior walkthrough.',
    transcript_status: 'done',
    transcript_text: FIVE_LINES,
    transcribed_at: '2026-09-27T19:55:35Z',
    narrated_at: '2026-09-22T01:16:00Z',
    checks: [],
    ai_findings: {
      conversation: STALE_CONVERSATION,
      timeline: [{ atSeconds: 0.5, summary: 'Camera holds on the ceiling light.' }],
    },
  };
  const item = serializeEvidence({
    proof,
    jobName: 'Job',
    jobNumber: 1,
    company: null,
    contactName: null,
    tier: 1,
    dayHasAfter: false,
    posterUrl: null,
  } as never) as { analysis: Record<string, unknown> };
  assert.equal(item.analysis.summaryState, 'quarantined');
  assert.equal(item.analysis.conversationExecutiveSummary ?? null, null);
  assert.deepEqual(item.analysis.conversationTurns ?? [], []);
  assert.doesNotMatch(JSON.stringify(item.analysis.evidenceLog ?? []), /single context-free fragment|exactly one spoken/);
  // A legacy row that only had atSeconds keeps its own time instead of 0:00.
  assert.deepEqual(item.analysis.timeline, [{ startSeconds: 0.5, summary: 'Camera holds on the ceiling light.' }]);
});
