import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../lib/errors.js';
import { getAiTrainingSetting, myClipFeedback, rateClipSummary, setAiTrainingSetting, shownSummary } from './clipSummaryFeedback.js';

type Call = { table: string; ops: Array<[string, unknown[]]> };
type Chain = { [method: string]: (...args: unknown[]) => Chain } & PromiseLike<unknown>;

/** A chainable stand-in for the Supabase client: records every call, answers per table. */
function fakeDb(answers: Record<string, unknown | ((call: Call) => unknown)>) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const result = () => {
        const a = answers[table];
        return Promise.resolve(typeof a === 'function' ? (a as (c: Call) => unknown)(call) : (a ?? { data: null, error: null }));
      };
      const chain = new Proxy(
        {},
        {
          get(_t, prop: string) {
            if (prop === 'then') return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => result().then(res, rej);
            return (...args: unknown[]) => {
              call.ops.push([prop, args]);
              return chain;
            };
          },
        },
      ) as Chain;
      return chain;
    },
  };
  return { db, calls };
}

const ORG = 'o1';
const JOB = 'j1';
const CLIP = 'p1';
const has = (call: Call, op: string, ...args: unknown[]) => call.ops.some(([o, a]) => o === op && JSON.stringify(a.slice(0, args.length)) === JSON.stringify(args));
const clipRow = { data: { id: CLIP, ai_summary: 'Crew pulled the wet drywall in the kitchen.', narration_text: null, ai_model: 'claude-haiku-4-5' }, error: null };

test('shownSummary falls back to the narration like the Videos tab', () => {
  assert.equal(shownSummary({ ai_summary: null, narration_text: ' Fans set in the hall. ' }), 'Fans set in the hall.');
  assert.equal(shownSummary({ ai_summary: '  ', narration_text: null }), null);
});

test('rateClipSummary refuses a clip that is not on this job in this workspace', async () => {
  const { db, calls } = fakeDb({ job_proofs: { data: null, error: null } });
  await assert.rejects(
    rateClipSummary(db, { orgId: ORG, jobId: JOB, proofId: 'p-other', userId: 'u1', rating: 1 }),
    (err: unknown) => err instanceof HttpError && err.status === 404,
  );
  const lookup = calls[0]!;
  assert.ok(has(lookup, 'eq', 'org_id', ORG));
  assert.ok(has(lookup, 'eq', 'job_id', JOB));
  assert.ok(has(lookup, 'is', 'deleted_at', null));
  assert.equal(calls.filter((c) => c.table === 'clip_summary_feedback').length, 0);
});

test('rateClipSummary stores the AI text read from the clip, not from the request', async () => {
  const { db, calls } = fakeDb({ job_proofs: clipRow, clip_summary_feedback: { data: null, error: null } });
  const out = await rateClipSummary(db, {
    orgId: ORG, jobId: JOB, proofId: CLIP, userId: 'u1', rating: -1, reason: 'missing',
    correctedText: '  Crew pulled the wet drywall in the kitchen and set two fans.  ',
  });
  assert.deepEqual(out, { rating: -1, reason: 'missing', correctedText: 'Crew pulled the wet drywall in the kitchen and set two fans.' });
  const write = calls.find((c) => c.table === 'clip_summary_feedback')!;
  const [row, opts] = write.ops.find(([o]) => o === 'upsert')![1] as [Record<string, unknown>, unknown];
  assert.equal(row.ai_text, 'Crew pulled the wet drywall in the kitchen.');
  assert.equal(row.ai_model, 'claude-haiku-4-5');
  assert.equal(row.org_id, ORG);
  assert.deepEqual(opts, { onConflict: 'proof_id,user_id' });
});

test('a thumbs up drops the reason, and a fix identical to the AI text is not a correction', async () => {
  const { db, calls } = fakeDb({ job_proofs: clipRow, clip_summary_feedback: { data: null, error: null } });
  const out = await rateClipSummary(db, {
    orgId: ORG, jobId: JOB, proofId: CLIP, userId: 'u1', rating: 1, reason: 'wrong',
    correctedText: 'Crew pulled the wet drywall in the kitchen.',
  });
  assert.deepEqual(out, { rating: 1, reason: null, correctedText: null });
  const row = calls.find((c) => c.table === 'clip_summary_feedback')!.ops.find(([o]) => o === 'upsert')![1][0] as Record<string, unknown>;
  assert.equal(row.corrected_text, null);
});

test('rating a clip with no summary yet is refused', async () => {
  const { db } = fakeDb({ job_proofs: { data: { id: CLIP, ai_summary: null, narration_text: null }, error: null } });
  await assert.rejects(
    rateClipSummary(db, { orgId: ORG, jobId: JOB, proofId: CLIP, userId: 'u1', rating: 1 }),
    (err: unknown) => err instanceof HttpError && err.status === 409,
  );
});

test('rating 0 clears only this person\'s row', async () => {
  const { db, calls } = fakeDb({ job_proofs: clipRow, clip_summary_feedback: { data: null, error: null } });
  assert.equal(await rateClipSummary(db, { orgId: ORG, jobId: JOB, proofId: CLIP, userId: 'u1', rating: 0 }), null);
  const del = calls.find((c) => c.table === 'clip_summary_feedback')!;
  assert.ok(has(del, 'delete'));
  assert.ok(has(del, 'eq', 'user_id', 'u1'));
  assert.ok(has(del, 'eq', 'org_id', ORG));
});

test('myClipFeedback keys this person\'s ratings by clip', async () => {
  const { db, calls } = fakeDb({
    clip_summary_feedback: { data: [{ proof_id: CLIP, rating: -1, reason: 'wrong', corrected_text: 'Fixed.' }], error: null },
  });
  assert.deepEqual(await myClipFeedback(db, { orgId: ORG, jobId: JOB, userId: 'u1' }), {
    [CLIP]: { rating: -1, reason: 'wrong', correctedText: 'Fixed.' },
  });
  assert.ok(has(calls[0]!, 'eq', 'user_id', 'u1'));
});

test('the training switch reads as off with no row, and saving records who changed it', async () => {
  const none = fakeDb({ org_ai_training_settings: { data: null, error: null } });
  assert.deepEqual(await getAiTrainingSetting(none.db, ORG), { optedIn: false, changedAt: null });
  const { db, calls } = fakeDb({ org_ai_training_settings: { data: null, error: null } });
  const saved = await setAiTrainingSetting(db, { orgId: ORG, userId: 'admin1', optedIn: true });
  assert.equal(saved.optedIn, true);
  const row = calls[0]!.ops.find(([o]) => o === 'upsert')![1][0] as Record<string, unknown>;
  assert.equal(row.org_id, ORG);
  assert.equal(row.changed_by, 'admin1');
  assert.equal(row.opted_in, true);
});
