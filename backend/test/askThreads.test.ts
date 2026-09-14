import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { titleFromFirstQuestion } from '../src/shared/askThreads.js';

const here = dirname(fileURLToPath(import.meta.url));

test('titleFromFirstQuestion truncates long first messages', () => {
  assert.equal(titleFromFirstQuestion('Short ask'), 'Short ask');
  const long = 'x'.repeat(100);
  const titled = titleFromFirstQuestion(long);
  assert.ok(titled.length <= 72);
  assert.ok(titled.endsWith('…'));
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

test('office Ask routes expose thread list/create and threadId on ask', () => {
  const proof = readFileSync(join(here, '../src/routes/proofOfWork.ts'), 'utf8');
  const shared = readFileSync(join(here, '../src/routes/sharedJobs.ts'), 'utf8');
  assert.match(proof, /export async function listJobAskThreads/);
  assert.match(proof, /export async function createJobAskThread/);
  assert.match(proof, /threadId: input\.threadId/);
  assert.match(shared, /ask\/threads/);
});

test('progress-share Ask persists share-scoped threads', () => {
  const progress = readFileSync(join(here, '../src/routes/progressShare.ts'), 'utf8');
  assert.match(progress, /ask\/threads/);
  assert.match(progress, /shareId: share\.id/);
  assert.match(progress, /kind: 'share'/);
});
