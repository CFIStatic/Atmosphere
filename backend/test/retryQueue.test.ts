import test from 'node:test';
import assert from 'node:assert/strict';
import { RetryQueue } from '../src/shared/retryQueue.js';

/**
 * The analysis queue.
 *
 * The property that matters most is the one the old code lacked: a failure
 * ends up in `onGaveUp`, visibly, instead of disappearing into a catch block.
 * The rest is the usual queue discipline — dedupe, order, retry spacing.
 */

const tick = () => new Promise((r) => setImmediate(r));
/** Settles once the queue has gone quiet, without real sleeping. */
async function drained(queue: { pending: number }) {
  for (let i = 0; i < 200 && queue.pending > 0; i += 1) await tick();
}

test('work runs, in the order it arrived', async () => {
  const ran: string[] = [];
  const queue = new RetryQueue<{ key: string }>({
    run: async (job) => {
      ran.push(job.key);
    },
  });

  queue.enqueue({ key: 'a' });
  queue.enqueue({ key: 'b' });
  queue.enqueue({ key: 'c' });
  await drained(queue);

  assert.deepEqual(ran, ['a', 'b', 'c']);
});

test('the same key twice is one job, and says so', async () => {
  // An upload retried on a bad signal enqueues the same day twice. Running it
  // twice would put two writers on one row.
  let runs = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const queue = new RetryQueue<{ key: string }>({
    run: async () => {
      runs += 1;
      await gate;
    },
  });

  assert.equal(queue.enqueue({ key: 'day-1' }), true);
  await tick();
  // Now in flight; the duplicate must be refused rather than queued behind.
  assert.equal(queue.enqueue({ key: 'day-1' }), false);
  release();
  await drained(queue);

  assert.equal(runs, 1);
});

test('a throw retries, with the configured spacing', async () => {
  const attempts: number[] = [];
  const slept: number[] = [];
  const queue = new RetryQueue<{ key: string }>({
    run: async (_job, attempt) => {
      attempts.push(attempt);
      if (attempt < 3) throw new Error('model flaked');
    },
    delaysMs: [10, 50, 250],
    sleep: async (ms) => {
      slept.push(ms);
    },
  });

  queue.enqueue({ key: 'flaky' });
  await drained(queue);

  assert.deepEqual(attempts, [1, 2, 3]);
  // Two failures, so two waits — and the spacing grows.
  assert.deepEqual(slept, [10, 50]);
});

test('when every attempt is spent, the failure is handed over — not swallowed', async () => {
  // The whole reason this queue exists.
  let gaveUp: { key: string; message: string } | null = null;
  const queue = new RetryQueue<{ key: string }>({
    run: async () => {
      throw new Error('the model reply was not usable');
    },
    delaysMs: [1],
    sleep: async () => {},
    onGaveUp: (job, error) => {
      gaveUp = { key: job.key, message: error instanceof Error ? error.message : String(error) };
    },
  });

  queue.enqueue({ key: 'doomed' });
  await drained(queue);

  assert.ok(gaveUp);
  assert.equal(gaveUp!.key, 'doomed');
  assert.match(gaveUp!.message, /not usable/);
});

test('one bad job does not take the ones behind it with it', async () => {
  const ran: string[] = [];
  const queue = new RetryQueue<{ key: string }>({
    run: async (job) => {
      if (job.key === 'bad') throw new Error('no');
      ran.push(job.key);
    },
    delaysMs: [],
    onGaveUp: async () => {
      throw new Error('and the failure hook is broken too');
    },
  });

  queue.enqueue({ key: 'bad' });
  queue.enqueue({ key: 'good' });
  await drained(queue);

  assert.deepEqual(ran, ['good']);
});

test('a key can be re-enqueued once its first run has settled', async () => {
  // Refilming a day after its analysis finished must analyse again.
  let runs = 0;
  const queue = new RetryQueue<{ key: string }>({
    run: async () => {
      runs += 1;
    },
  });

  queue.enqueue({ key: 'day' });
  await drained(queue);
  assert.equal(queue.enqueue({ key: 'day' }), true);
  await drained(queue);

  assert.equal(runs, 2);
});
