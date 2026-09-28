import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { displayMentionText } from '../src/shared/mentions.js';
import {
  acceptModelAskTitle,
  listAskThreads,
  modelAskThreadTitle,
  presentAskThread,
  renameAskThread,
  titleFromFirstQuestion,
  touchAskThreadAfterMessage,
} from '../src/shared/askThreads.js';

const here = dirname(fileURLToPath(import.meta.url));

const EL = '111832c2-d6f9-4412-86ce-1fccc439eb40';
const CHIP = `@[El Presidente](mention:${EL})`;

test('titleFromFirstQuestion truncates long first messages', () => {
  assert.equal(titleFromFirstQuestion('Short ask'), 'Short ask');
  const long = 'x'.repeat(100);
  const titled = titleFromFirstQuestion(long);
  assert.ok(titled.length <= 72);
  assert.ok(titled.endsWith('…'));
});

test('titles render a mention as @Name and never keep the id', () => {
  assert.equal(displayMentionText(`what activity does ${CHIP}`), 'what activity does @El Presidente');
  const truncated = 'what activity does @[El Presidente](mention:111832c2-d6f9-4412-86ce-1…';
  assert.equal(titleFromFirstQuestion(truncated), 'what activity does @El Presidente');
  assert.equal(titleFromFirstQuestion(`what had ${CHIP}`), 'what had @El Presidente');
  const shown = presentAskThread({
    id: 't1',
    org_id: 'o',
    job_id: 'j',
    owner_user_id: 'u',
    share_id: null,
    title: truncated,
    created_at: '2026-09-17T00:00:00Z',
    updated_at: '2026-09-17T00:00:00Z',
    last_message_at: null,
  });
  assert.equal(shown.title, 'what activity does @El Presidente');
  assert.equal(shown.title.includes(EL), false);
  assert.equal(shown.title.includes('mention:'), false);
});

test('a model title is 3 to 6 words, and a bad title falls back', () => {
  assert.equal(acceptModelAskTitle("El Presidente's activity"), "El Presidente's activity");
  assert.equal(acceptModelAskTitle('Internet connection question.'), 'Internet connection question');
  assert.equal(acceptModelAskTitle(`@El Presidente ${EL}`), null);
  assert.equal(acceptModelAskTitle('Hi'), null);
});

test('modelAskThreadTitle keeps the name and drops the id before the model sees it', async () => {
  let seen = '';
  const title = await modelAskThreadTitle({
    question: `what activity does ${CHIP}`,
    answer: 'He sampled the intervals.',
    complete: async (input) => {
      seen = input.user;
      return { text: "El Presidente's activity" };
    },
  });
  assert.equal(title, "El Presidente's activity");
  assert.equal(seen.includes(EL), false);
  assert.equal(seen.includes('mention:'), false);
  assert.match(seen, /@El Presidente/);
  const failed = await modelAskThreadTitle({
    question: `what activity does ${CHIP}`,
    complete: async () => {
      throw new Error('offline');
    },
  });
  assert.equal(failed, null);
});

function threadClient(initialTitle: string, rows?: Array<Record<string, unknown>>) {
  let title = initialTitle;
  const writes: Array<{ table: string; title?: string }> = [];
  const supabase = {
    from(table: string) {
      const b: {
        _patch: Record<string, unknown> | null;
        select: () => typeof b;
        eq: () => typeof b;
        is: () => typeof b;
        order: () => typeof b;
        limit: () => typeof b;
        update: (patch: Record<string, unknown>) => typeof b;
        maybeSingle: () => Promise<{ data: { title: string }; error: null }>;
        single: () => Promise<{ data: Record<string, unknown>; error: null }>;
        then: (resolve: (value: { data: unknown; error: null }) => void) => void;
      } = {
        _patch: null,
        select() { return this; },
        eq() { return this; },
        is() { return this; },
        order() { return this; },
        limit() { return this; },
        update(patch) {
          this._patch = patch;
          if (typeof patch.title === 'string') {
            title = patch.title;
            writes.push({ table, title: patch.title });
          } else {
            writes.push({ table });
          }
          return this;
        },
        maybeSingle() {
          return Promise.resolve({ data: { title }, error: null });
        },
        single() {
          return Promise.resolve({
            data: {
              id: 't1',
              org_id: 'o',
              job_id: 'j',
              owner_user_id: 'u',
              share_id: null,
              title,
              created_at: '2026-09-17T00:00:00Z',
              updated_at: '2026-09-17T00:00:00Z',
              last_message_at: null,
            },
            error: null,
          });
        },
        then(resolve) {
          resolve({ data: this._patch ? null : (rows ?? []), error: null });
        },
      };
      return b;
    },
  };
  return { supabase: supabase as never, writes, current: () => title };
}

test('first exchange stores a short model title and a failed model keeps the cleaned question', async () => {
  const ok = threadClient('New chat');
  await touchAskThreadAfterMessage(ok.supabase, {
    threadId: 't1',
    question: `what activity does ${CHIP}`,
    answer: 'He sampled the intervals on September 17.',
    isFirstMessage: true,
    complete: async () => ({ text: "El Presidente's activity" }),
  });
  assert.equal(ok.current(), "El Presidente's activity");

  const down = threadClient('New chat');
  await touchAskThreadAfterMessage(down.supabase, {
    threadId: 't1',
    question: `what activity does ${CHIP}`,
    answer: 'He sampled the intervals.',
    isFirstMessage: true,
    complete: async () => null,
  });
  assert.equal(down.current(), 'what activity does @El Presidente');
  assert.equal(down.current().includes('mention:'), false);
});

test('a renamed chat keeps its name', async () => {
  let calls = 0;
  const db = threadClient('Tarp notes');
  await touchAskThreadAfterMessage(db.supabase, {
    threadId: 't1',
    question: `what activity does ${CHIP}`,
    isFirstMessage: true,
    complete: async () => {
      calls += 1;
      return { text: 'Should not replace' };
    },
  });
  assert.equal(calls, 0);
  assert.equal(db.current(), 'Tarp notes');
});

test('rename stores the cleaned name', async () => {
  const db = threadClient('New chat');
  const row = await renameAskThread(db.supabase, {
    orgId: 'o',
    jobId: 'j',
    threadId: 't1',
    owner: { kind: 'user', userId: 'u' },
    title: `  what activity does ${CHIP}  `,
  });
  assert.equal(row.title, 'what activity does @El Presidente');
  assert.equal(String(row.title).includes(EL), false);
});

test('listing threads backfills raw titles and does not write custody rows', async () => {
  const raw = `what activity does ${CHIP}`;
  const db = threadClient(raw, [
    {
      id: 't1',
      org_id: 'o',
      job_id: 'j',
      owner_user_id: 'u',
      share_id: null,
      title: raw,
      created_at: '2026-09-17T00:00:00Z',
      updated_at: '2026-09-17T00:00:00Z',
      last_message_at: '2026-09-17T00:00:00Z',
    },
  ]);
  const listed = await listAskThreads(db.supabase, {
    orgId: 'o',
    jobId: 'j',
    owner: { kind: 'user', userId: 'u' },
  });
  assert.equal(listed[0]?.title, 'what activity does @El Presidente');
  assert.ok(db.writes.some((write) => write.table === 'ask_threads'));
  assert.equal(db.writes.some((write) => write.table === 'job_proof_questions'), false);
  assert.equal(db.writes.some((write) => write.table === 'job_evidence_access'), false);
});

test('migration defines ask_threads and job_proof_questions.thread_id', () => {
  const sql = readFileSync(
    join(here, '../../supabase/migrations/20260915010000_ask_threads.sql'),
    'utf8',
  );
  assert.match(sql, /create table if not exists public\.ask_threads/);
  assert.match(sql, /add column if not exists thread_id/);
  assert.match(sql, /ask_threads_owner_xor/);
});

test('office Ask routes expose thread list/create/rename and threadId on ask', () => {
  const proof = readFileSync(join(here, '../src/routes/proofOfWork.ts'), 'utf8');
  const shared = readFileSync(join(here, '../src/routes/sharedJobs.ts'), 'utf8');
  const threads = readFileSync(join(here, '../src/shared/askThreads.ts'), 'utf8');
  assert.match(proof, /export async function listJobAskThreads/);
  assert.match(proof, /export async function createJobAskThread/);
  assert.match(proof, /export async function renameJobAskThread/);
  assert.match(proof, /threadId: input\.threadId/);
  assert.match(shared, /ask\/threads/);
  assert.match(shared, /ask\/threads\/:threadId/);
  assert.match(threads, /export async function renameAskThread/);
  assert.match(threads, /user rename sticks/);
});

test('progress-share Ask persists share-scoped threads', () => {
  const progress = readFileSync(join(here, '../src/routes/progressShare.ts'), 'utf8');
  assert.match(progress, /ask\/threads/);
  assert.match(progress, /ask\/threads\/:threadId/);
  assert.match(progress, /shareId: share\.id/);
  assert.match(progress, /kind: 'share'/);
});
