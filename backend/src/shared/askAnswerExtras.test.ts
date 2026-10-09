import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../lib/errors.js';
import { listPinnedAnswers, myFeedback, plainAskText, rateAnswer, searchAskHistory, snippetAround } from './askAnswerExtras.js';

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
const has = (call: Call, op: string, ...args: unknown[]) => call.ops.some(([o, a]) => o === op && JSON.stringify(a.slice(0, args.length)) === JSON.stringify(args));

test('rateAnswer refuses a question that is not on this job', async () => {
  const { db, calls } = fakeDb({ job_proof_questions: { data: null, error: null } });
  await assert.rejects(
    rateAnswer(db, { orgId: ORG, jobId: JOB, questionId: 'q-other-job', userId: 'u1', rating: 1 }),
    (err: unknown) => err instanceof HttpError && err.status === 404,
  );
  assert.ok(has(calls[0], 'eq', 'org_id', ORG) && has(calls[0], 'eq', 'job_id', JOB));
  assert.equal(calls.some((c) => c.table === 'ask_answer_feedback'), false, 'nothing written');
});

test('rateAnswer stores one row per person; thumbs up drops the reason; 0 clears', async () => {
  const { db, calls } = fakeDb({
    job_proof_questions: { data: { id: 'q1', thread_id: 't1', created_at: 'x' }, error: null },
    ask_answer_feedback: { data: null, error: null },
  });
  assert.deepEqual(await rateAnswer(db, { orgId: ORG, jobId: JOB, questionId: 'q1', userId: 'u1', rating: -1, reason: 'incomplete', comment: ' missed Tuesday ' }), { rating: -1, reason: 'incomplete' });
  const up1 = calls.find((c) => c.table === 'ask_answer_feedback')!;
  const [row, opts] = up1.ops.find(([o]) => o === 'upsert')![1] as [Record<string, unknown>, Record<string, unknown>];
  assert.equal(row.user_id, 'u1');
  assert.equal(row.comment, 'missed Tuesday');
  assert.deepEqual(opts, { onConflict: 'question_id,user_id' });

  assert.deepEqual(await rateAnswer(db, { orgId: ORG, jobId: JOB, questionId: 'q1', userId: 'u1', rating: 1, reason: 'wrong' }), { rating: 1, reason: null });
  assert.equal(await rateAnswer(db, { orgId: ORG, jobId: JOB, questionId: 'q1', userId: 'u1', rating: 0 }), null);
  const del = calls.filter((c) => c.table === 'ask_answer_feedback').at(-1)!;
  assert.ok(has(del, 'delete') && has(del, 'eq', 'user_id', 'u1'), 'clears only this person’s rating');
});

test('myFeedback reads only this person’s ratings on this job', async () => {
  const { db, calls } = fakeDb({ ask_answer_feedback: { data: [{ question_id: 'q1', rating: -1, reason: 'wrong' }], error: null } });
  assert.deepEqual(await myFeedback(db, { orgId: ORG, jobId: JOB, userId: 'u1', questionIds: ['q1', 'q1', 'q2'] }), { q1: { rating: -1, reason: 'wrong' } });
  assert.ok(has(calls[0], 'eq', 'user_id', 'u1') && has(calls[0], 'eq', 'job_id', JOB));
  assert.ok(has(calls[0], 'in', 'question_id', ['q1', 'q2']));
});

test('listPinnedAnswers joins the Q&A and who pinned it', async () => {
  const { db } = fakeDb({
    ask_pinned_answers: { data: [{ id: 'p1', question_id: 'q1', pinned_by: 'u2', created_at: '2026-10-09T10:00:00Z' }], error: null },
    job_proof_questions: { data: [{ id: 'q1', question: 'What did @[Dana](mention:x) say?', answer: 'She approved the scope.', created_at: '2026-10-08T10:00:00Z' }], error: null },
    profiles: { data: [{ id: 'u2', full_name: 'Sam Office', email: 's@test.invalid' }], error: null },
  });
  const pins = await listPinnedAnswers(db, { orgId: ORG, jobId: JOB });
  assert.equal(pins.length, 1);
  assert.equal(pins[0].question, 'What did @Dana say?');
  assert.equal(pins[0].pinnedBy, 'Sam Office');
});

test('searchAskHistory searches only this person’s chats on the job, with the text escaped', async () => {
  const { db, calls } = fakeDb({
    ask_threads: { data: [{ id: 't1', title: 'Roof questions', last_message_at: null, created_at: '2026-10-01T00:00:00Z' }, { id: 't2', title: 'Permit 50% done', last_message_at: null, created_at: '2026-10-02T00:00:00Z' }], error: null },
    job_proof_questions: { data: [{ id: 'q9', thread_id: 't1', question: 'When was the roof tarp put on?', answer: 'On **Oct 3** ⟦sources: video/x⟧', created_at: '2026-10-03T00:00:00Z' }], error: null },
  });
  const hits = await searchAskHistory(db, { orgId: ORG, jobId: JOB, userId: 'u1', query: 'tarp' });
  assert.deepEqual(hits.map((h) => [h.threadId, h.questionId]), [['t1', 'q9']]);
  assert.match(hits[0].snippet, /roof tarp/);
  const threads = calls.find((c) => c.table === 'ask_threads')!;
  assert.ok(has(threads, 'eq', 'owner_user_id', 'u1'), 'own chats only');
  const qs = calls.find((c) => c.table === 'job_proof_questions')!;
  assert.ok(has(qs, 'in', 'thread_id', ['t1', 't2']));

  const { db: db2, calls: calls2 } = fakeDb({ ask_threads: { data: [{ id: 't2', title: 'Permit 50% done', last_message_at: null, created_at: 'x' }], error: null }, job_proof_questions: { data: [], error: null } });
  const byTitle = await searchAskHistory(db2, { orgId: ORG, jobId: JOB, userId: 'u1', query: '50%' });
  assert.deepEqual(byTitle.map((h) => [h.threadId, h.questionId]), [['t2', null]], 'a title match returns the chat');
  const or = calls2.find((c) => c.table === 'job_proof_questions')!.ops.find(([o]) => o === 'or')![1][0] as string;
  assert.equal(or, 'question.ilike.%50\\%%,answer.ilike.%50\\%%', 'the % is literal');

  assert.deepEqual(await searchAskHistory(db2, { orgId: ORG, jobId: JOB, userId: 'u1', query: 'a' }), [], 'one letter is not a search');
});

test('snippets are plain text around the match', () => {
  assert.equal(plainAskText('**Bold** answer ⟦followups: a? ;; b?⟧'), 'Bold answer');
  const long = `${'x '.repeat(80)}the dumpster arrives Monday ${'y '.repeat(80)}`;
  const snip = snippetAround(long, 'dumpster');
  assert.match(snip, /^….*the dumpster arrives Monday.*…$/);
  assert.ok(snip.length < 160);
});
