import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DurableOutboxWorker,
  leaseIsClaimable,
  type ClaimStore,
  type OutboxRow,
} from './durableOutbox.js';

interface Job extends OutboxRow {
  status: 'pending' | 'running' | 'completed' | 'failed';
  leaseOwner: string | null;
  leaseUntil: string | null;
  attempts: number;
}

class MemoryOutbox implements ClaimStore<Job> {
  readonly rows = new Map<string, Job>();
  nowMs = Date.now();

  seed(id: string, patch: Partial<Job> = {}): Job {
    const row: Job = {
      id,
      status: 'pending',
      leaseOwner: null,
      leaseUntil: null,
      attempts: 0,
      ...patch,
    };
    this.rows.set(id, row);
    return row;
  }

  async listClaimable(limit: number): Promise<Job[]> {
    const out: Job[] = [];
    for (const row of this.rows.values()) {
      if (row.status !== 'pending' && row.status !== 'running') continue;
      if (!leaseIsClaimable(row.leaseUntil, row.leaseOwner, 'unused-list', this.nowMs)) {
        // list ignores owner — only expiry/null. Re-check without owner match.
        if (row.leaseUntil && Date.parse(row.leaseUntil) > this.nowMs) continue;
      }
      if (row.leaseUntil && Date.parse(row.leaseUntil) > this.nowMs) continue;
      out.push({ ...row });
      if (out.length >= limit) break;
    }
    return out;
  }

  async claim(id: string, owner: string, untilIso: string): Promise<Job | null> {
    const row = this.rows.get(id);
    if (!row) return null;
    if (row.status === 'completed' || row.status === 'failed') return null;
    if (!leaseIsClaimable(row.leaseUntil, row.leaseOwner, owner, this.nowMs)) return null;
    const next: Job = {
      ...row,
      status: 'running',
      leaseOwner: owner,
      leaseUntil: untilIso,
    };
    this.rows.set(id, next);
    return { ...next };
  }
}

describe('leaseIsClaimable', () => {
  it('allows a missing or expired lease, and the current owner', () => {
    const now = 1_000_000;
    assert.equal(leaseIsClaimable(null, null, 'a', now), true);
    assert.equal(leaseIsClaimable(new Date(now - 1).toISOString(), 'b', 'a', now), true);
    assert.equal(leaseIsClaimable(new Date(now + 60_000).toISOString(), 'a', 'a', now), true);
    assert.equal(leaseIsClaimable(new Date(now + 60_000).toISOString(), 'b', 'a', now), false);
  });
});

describe('DurableOutboxWorker', () => {
  it('claims a persisted job and completes it', async () => {
    const store = new MemoryOutbox();
    store.seed('job-1');
    const ran: string[] = [];
    const worker = new DurableOutboxWorker<Job>({
      store,
      owner: 'worker-a',
      delaysMs: [],
      sleep: async () => undefined,
      now: () => store.nowMs,
      run: async (row) => {
        ran.push(row.id);
        const cur = store.rows.get(row.id)!;
        store.rows.set(row.id, {
          ...cur,
          status: 'completed',
          leaseOwner: null,
          leaseUntil: null,
        });
      },
    });

    const n = await worker.tick();
    assert.equal(n, 1);
    assert.deepEqual(ran, ['job-1']);
    assert.equal(store.rows.get('job-1')?.status, 'completed');
  });

  it('only one worker wins a concurrent claim', async () => {
    const store = new MemoryOutbox();
    store.seed('job-1');
    const until = new Date(store.nowMs + 90_000).toISOString();
    const first = await store.claim('job-1', 'a', until);
    const second = await store.claim('job-1', 'b', until);
    assert.ok(first);
    assert.equal(first.leaseOwner, 'a');
    assert.equal(second, null);

    let ran = 0;
    const late = new DurableOutboxWorker<Job>({
      store,
      owner: 'b',
      delaysMs: [],
      sleep: async () => undefined,
      now: () => store.nowMs,
      run: async () => {
        ran += 1;
      },
    });
    assert.equal(await late.tick(), 0);
    assert.equal(ran, 0);
    assert.equal(store.rows.get('job-1')?.leaseOwner, 'a');
  });

  it('completes after a simulated crash: expired lease, new worker, no in-memory queue', async () => {
    const store = new MemoryOutbox();
    store.seed('job-1');

    const crashed = new DurableOutboxWorker<Job>({
      store,
      owner: 'pid-old',
      delaysMs: [],
      sleep: async () => undefined,
      now: () => store.nowMs,
      run: async (row) => {
        const cur = store.rows.get(row.id)!;
        store.rows.set(row.id, {
          ...cur,
          status: 'running',
          attempts: cur.attempts + 1,
        });
        throw new Error('process crashed');
      },
    });

    await crashed.tick();
    assert.equal(store.rows.get('job-1')?.status, 'running');
    assert.equal(store.rows.get('job-1')?.attempts, 1);
    // Crash: drop the worker. Lease is still held until we expire it.
    crashed.stop();

    store.nowMs += 120_000;
    const after = store.rows.get('job-1')!;
    store.rows.set('job-1', {
      ...after,
      leaseUntil: new Date(store.nowMs - 1_000).toISOString(),
    });

    const recovered = new DurableOutboxWorker<Job>({
      store,
      owner: 'pid-new',
      delaysMs: [],
      sleep: async () => undefined,
      now: () => store.nowMs,
      run: async (row) => {
        const cur = store.rows.get(row.id)!;
        store.rows.set(row.id, {
          ...cur,
          status: 'completed',
          attempts: cur.attempts + 1,
          leaseOwner: null,
          leaseUntil: null,
        });
      },
    });

    const n = await recovered.tick();
    assert.equal(n, 1);
    const done = store.rows.get('job-1')!;
    assert.equal(done.status, 'completed');
    assert.equal(done.attempts, 2);
    assert.equal(done.leaseOwner, null);
  });

  it('does not steal a live lease from another replica', async () => {
    const store = new MemoryOutbox();
    store.seed('job-1', {
      status: 'running',
      leaseOwner: 'other',
      leaseUntil: new Date(store.nowMs + 60_000).toISOString(),
    });
    let ran = 0;
    const worker = new DurableOutboxWorker<Job>({
      store,
      owner: 'me',
      delaysMs: [],
      sleep: async () => undefined,
      now: () => store.nowMs,
      run: async () => {
        ran += 1;
      },
    });
    const n = await worker.tick();
    assert.equal(n, 0);
    assert.equal(ran, 0);
    assert.equal(store.rows.get('job-1')?.leaseOwner, 'other');
  });
});
