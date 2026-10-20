/**
 * Guards for recurring Postgres errors seen in production logs:
 * - Ask read computer_tasks with the signed-in user's client (permission denied).
 * - frame_observations / verification_frames inserts collided on re-runs (duplicate key).
 */
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MemoryComputerStore } from '../src/computer/store.js';
import type { NewTask } from '../src/computer/store.js';
import { setComputerWorkerDepsForTests } from '../src/computer/worker.js';
import { loadAskComputerContext } from '../src/shared/askComputerContext.js';
import type { AskToolContext } from '../src/shared/askTools.js';

afterEach(() => setComputerWorkerDepsForTests(null));

const ORG = '00000000-0000-0000-0000-0000000000a1';
const JOB = '00000000-0000-0000-0000-0000000000b1';

function task(over: Partial<NewTask>): NewTask {
  return {
    org_id: ORG,
    job_id: JOB,
    created_by: null,
    instructions: 'Check the claim portal',
    start_url: null,
    job_projection: [],
    model_id: 'mock',
    max_steps: 10,
    budget_nanos: 1,
    ...over,
  } as unknown as NewTask;
}

test('Ask reads Computer results through the store, never the user client', async () => {
  const store = new MemoryComputerStore();
  const mine = await store.insertTask(task({}));
  await store.updateTask(mine.id, {
    status: 'needs_you',
    needs_you: { reason: 'mfa', message: 'Approve', code: '42' },
  } as never);
  await store.insertTask(task({ org_id: '00000000-0000-0000-0000-0000000000a2' }));
  await store.insertTask(task({ job_id: '00000000-0000-0000-0000-0000000000b2' }));
  setComputerWorkerDepsForTests({ store, admin: null });
  const userClient = {
    from(table: string) {
      throw new Error(`user client must not read ${table}`);
    },
  };
  const ctx = {
    access: 'org',
    userId: 'u1',
    orgId: ORG,
    jobId: JOB,
    savedLogins: [],
    supabase: userClient,
  } as unknown as AskToolContext;
  const out = await loadAskComputerContext(ctx);
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].id, mine.id);
  assert.deepEqual(out.results[0].waiting, { reason: 'mfa', message: 'Approve', code: '42' });
});

test('frame saves ignore rows already written by an earlier attempt', () => {
  const analyzer = readFileSync(
    new URL('../src/verification/ai/analyzer.ts', import.meta.url),
    'utf8',
  );
  assert.match(
    analyzer,
    /from\('frame_observations'\)\.upsert\([\s\S]*?onConflict: 'analysis_run_id,frame_id', ignoreDuplicates: true/,
  );
  const extract = readFileSync(
    new URL('../src/verification/frames/extract.ts', import.meta.url),
    'utf8',
  );
  assert.match(extract, /onConflict: 'video_id,sequence_number', ignoreDuplicates: true/);
});
