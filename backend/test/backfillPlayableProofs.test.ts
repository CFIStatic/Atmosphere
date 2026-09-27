import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  PLAYABLE_BACKFILL_BOOT_DELAY_MS,
  backfillPlayableProofs,
  playableBackfillOnBootEnabled,
  schedulePlayableProofBackfill,
  type PlayableBackfillClip,
  type PlayableBackfillResult,
} from '../src/lib/backfillPlayableProofs.js';
import { PROOF_PLAYABLE_SUFFIX } from '../src/lib/proofPlayableUrl.js';
import { ensureStillsAndDuration } from '../src/routes/proofOfWork.js';

type Row = { id: string; storage_path: string | null; byte_size?: number | string | null };

function asAdmin(admin: unknown): SupabaseClient {
  return admin as SupabaseClient;
}

async function writeFakeMp4(_bin: string, args: string[]) {
  const out = args[args.length - 1] ?? '';
  const { writeFile, mkdir } = await import('node:fs/promises');
  const { dirname: dir } = await import('node:path');
  await mkdir(dir(out), { recursive: true });
  await writeFile(out, Buffer.from('ftypisom-fake-mp4-bytes'));
  return { stdout: '', stderr: '', code: 0 };
}

function storageDouble(seed?: { present?: string[]; sizes?: Record<string, number> }) {
  const present = new Set(seed?.present ?? []);
  const sizes = new Map(Object.entries(seed?.sizes ?? {}));
  const searches: string[] = [];
  const uploads: Array<{ path: string; type: string; bytes: number }> = [];
  const api = {
    async list(_folder: string, opts?: { search?: string }) {
      const name = opts?.search ?? '';
      searches.push(name);
      if (!present.has(name) && !sizes.has(name)) return { data: [], error: null };
      const metadata = sizes.has(name) ? { size: sizes.get(name) } : { size: 8_000 };
      if (!present.has(name) && sizes.has(name)) {
        return { data: [{ name, metadata }], error: null };
      }
      return { data: [{ name, metadata }], error: null };
    },
    async createSignedUrl(path: string, expires: number) {
      return { data: { signedUrl: `https://storage.test/${path}?e=${expires}` }, error: null };
    },
    async upload(path: string, bytes: Buffer, opts: { contentType: string }) {
      uploads.push({ path, type: opts.contentType, bytes: bytes.length });
      const name = path.split('/').pop() ?? path;
      present.add(name);
      return { error: null };
    },
  };
  return { api, searches, uploads, present, sizes };
}

function proofsAdmin(
  rows: Row[],
  storage: ReturnType<typeof storageDouble>['api'],
  capture?: { ranges: Array<[number, number]>; orders: string[] },
) {
  const q = {
    select() {
      return q;
    },
    is() {
      return q;
    },
    order(column: string) {
      capture?.orders.push(column);
      return q;
    },
    range(start: number, end: number) {
      capture?.ranges.push([start, end]);
      return Promise.resolve({ data: rows.slice(start, end + 1), error: null });
    },
  };
  return asAdmin({
    from(table: string) {
      if (table !== 'job_proofs') throw new Error(`unexpected table ${table}`);
      return q;
    },
    storage: {
      from() {
        return storage;
      },
    },
  });
}

function totals(result: PlayableBackfillResult): number {
  return result.built + result.alreadyPlayable + result.skipped + result.failed;
}

test('playableBackfillOnBootEnabled is on unless the env is exactly 0', () => {
  assert.equal(playableBackfillOnBootEnabled({ PROOF_PLAYABLE_BACKFILL_ON_BOOT: '0' }), false);
  assert.equal(playableBackfillOnBootEnabled({}), true);
  assert.equal(playableBackfillOnBootEnabled({ PROOF_PLAYABLE_BACKFILL_ON_BOOT: '1' }), true);
  assert.equal(playableBackfillOnBootEnabled({ PROOF_PLAYABLE_BACKFILL_ON_BOOT: '' }), true);
  assert.equal(playableBackfillOnBootEnabled({ PROOF_PLAYABLE_BACKFILL_ON_BOOT: 'false' }), true);
  assert.equal(PLAYABLE_BACKFILL_BOOT_DELAY_MS, 60_000);

  const previous = process.env.PROOF_PLAYABLE_BACKFILL_ON_BOOT;
  try {
    process.env.PROOF_PLAYABLE_BACKFILL_ON_BOOT = '0';
    assert.equal(playableBackfillOnBootEnabled(), false);
    delete process.env.PROOF_PLAYABLE_BACKFILL_ON_BOOT;
    assert.equal(playableBackfillOnBootEnabled(), true);
  } finally {
    if (previous === undefined) delete process.env.PROOF_PLAYABLE_BACKFILL_ON_BOOT;
    else process.env.PROOF_PLAYABLE_BACKFILL_ON_BOOT = previous;
  }
});

test('schedulePlayableProofBackfill does not arm a timer when the env gate is off', () => {
  let armed = false;
  const scheduled = schedulePlayableProofBackfill({
    env: { PROOF_PLAYABLE_BACKFILL_ON_BOOT: '0' },
    setTimer: () => {
      armed = true;
    },
  });
  assert.equal(scheduled, false);
  assert.equal(armed, false);
});

test('schedulePlayableProofBackfill logs each clip after boot without blocking startup', async () => {
  const logs: string[] = [];
  let ran = false;
  let fire: (() => Promise<void>) | null = null;
  const scheduled = schedulePlayableProofBackfill({
    env: {},
    getAdmin: () => asAdmin({}),
    log: (line) => logs.push(line),
    setTimer: (fn, delayMs) => {
      assert.equal(delayMs, 60_000);
      fire = fn;
    },
    run: async (_admin, opts) => {
      ran = true;
      opts?.onClip?.({ id: 'p1', outcome: 'built', path: 'org/p1.play.mp4' });
      opts?.onClip?.({ id: 'p2', outcome: 'failed', reason: 'ffmpeg died', path: 'org/p2.webm' });
      opts?.onClip?.({
        id: 'p3',
        outcome: 'skipped',
        reason: 'file is 12 bytes (under 1 KB)',
        path: 'org/p3.webm',
      });
      opts?.onClip?.({ id: 'p4', outcome: 'alreadyPlayable', path: 'org/p4.play.mp4' });
      opts?.onClip?.({ id: 'p5', outcome: 'skipped', path: 'org/note.jpg' });
      return {
        checked: 5,
        built: 1,
        alreadyPlayable: 1,
        skipped: 2,
        failed: 1,
        failures: [{ id: 'p2', reason: 'ffmpeg died' }],
      };
    },
  });

  assert.equal(scheduled, true);
  assert.equal(ran, false);
  assert.equal(logs.length, 0);
  assert.ok(fire);
  await fire!();

  assert.deepEqual(logs, [
    '[playable-backfill] playable p1',
    '[playable-backfill] failed p2: ffmpeg died',
    '[playable-backfill] skipped p3: file is 12 bytes (under 1 KB)',
    '[playable-backfill] {"checked":5,"built":1,"alreadyPlayable":1,"skipped":2,"failed":1,"failures":[{"id":"p2","reason":"ffmpeg died"}]}',
  ]);
});

test('schedulePlayableProofBackfill never rejects when admin, the run, or the logger fails', async () => {
  const logs: string[] = [];
  const arm = async (opts: Parameters<typeof schedulePlayableProofBackfill>[0]) => {
    let fire: (() => Promise<void>) | null = null;
    const scheduled = schedulePlayableProofBackfill({
      env: {},
      log: (line) => logs.push(line),
      setTimer: (fn) => {
        fire = fn;
      },
      ...opts,
    });
    assert.equal(scheduled, true);
    await fire!();
  };

  await arm({ getAdmin: () => null });
  assert.equal(logs.at(-1), '[playable-backfill] skipped: no admin client');

  await arm({
    getAdmin: () => asAdmin({}),
    run: async () => {
      throw new Error('relation job_proofs does not exist');
    },
  });
  assert.equal(logs.at(-1), '[playable-backfill] aborted: relation job_proofs does not exist');

  await arm({
    getAdmin: () => {
      throw new Error('admin exploded');
    },
  });
  assert.equal(logs.at(-1), '[playable-backfill] aborted: admin exploded');

  await arm({
    getAdmin: () => asAdmin({}),
    log: () => {
      throw new Error('log sink down');
    },
    run: async () => {
      throw new Error('still running');
    },
  });
});

test('index starts the backfill beside the analysis sweep only for sold-path workers', () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../src/index.ts'),
    'utf8',
  );
  const blockStart = src.indexOf('if (runSoldPathWorkers)');
  assert.ok(blockStart >= 0);
  const block = src.slice(blockStart, src.indexOf('});', blockStart));
  const sweepAt = block.indexOf('startProofAnalysisSweep()');
  const backfillAt = block.indexOf('schedulePlayableProofBackfill()');
  assert.ok(sweepAt >= 0);
  assert.ok(backfillAt > sweepAt);
  assert.match(src, /stopPlayableProofBackfill\(\)/);
  assert.doesNotMatch(src.slice(0, blockStart), /schedulePlayableProofBackfill\(\)/);
});

test('backfillPlayableProofs builds one missing clip, skips stubs, and records failures', async () => {
  const storage = storageDouble();
  const clips: PlayableBackfillClip[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const order: string[] = [];
  const rows: Row[] = [
    { id: 'empty', storage_path: null },
    { id: 'photo', storage_path: 'org/job/still.jpg', byte_size: 40_000 },
    { id: 'already-copy', storage_path: 'org/job/done.webm', byte_size: 9_000 },
    { id: 'stub-column', storage_path: 'org/job/tiny.webm', byte_size: 12 },
    { id: 'stub-meta', storage_path: 'org/job/meta-tiny.webm', byte_size: null },
    { id: 'first', storage_path: 'org/job/first.webm', byte_size: 50_000 },
    { id: 'second', storage_path: 'org/job/second.webm', byte_size: '80000' },
    { id: 'broken', storage_path: 'org/job/broken.webm', byte_size: 50_000 },
    { id: 'sibling', storage_path: `org/job/sibling${PROOF_PLAYABLE_SUFFIX}`, byte_size: 50_000 },
  ];
  storage.present.add(`done${PROOF_PLAYABLE_SUFFIX}`);
  storage.sizes.set('meta-tiny.webm', 40);

  const result = await backfillPlayableProofs(
    proofsAdmin(rows, storage.api),
    {
      onClip: (clip) => clips.push(clip),
      runner: async (bin, args) => {
        const input = args[args.indexOf('-i') + 1] ?? '';
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        order.push(`start ${input}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push(`end ${input}`);
        inFlight -= 1;
        if (input.includes('broken.webm')) {
          return { stdout: '', stderr: 'ffmpeg died', code: 1 };
        }
        return writeFakeMp4(bin, args);
      },
    },
  );

  assert.equal(result.checked, rows.length);
  assert.equal(result.built, 2);
  assert.equal(result.alreadyPlayable, 1);
  assert.equal(result.skipped, 5);
  assert.equal(result.failed, 1);
  assert.equal(totals(result), result.checked);
  assert.deepEqual(result.failures, [{ id: 'broken', reason: 'ffmpeg died' }]);
  assert.equal(maxInFlight, 1);
  assert.deepEqual(
    order.map((line) => line.replace(/^start |^end /, '')),
    [
      'https://storage.test/org/job/first.webm?e=1800',
      'https://storage.test/org/job/first.webm?e=1800',
      'https://storage.test/org/job/second.webm?e=1800',
      'https://storage.test/org/job/second.webm?e=1800',
      'https://storage.test/org/job/broken.webm?e=1800',
      'https://storage.test/org/job/broken.webm?e=1800',
    ],
  );
  assert.ok(order.indexOf('end https://storage.test/org/job/first.webm?e=1800') < order.indexOf('start https://storage.test/org/job/second.webm?e=1800'));
  assert.equal(storage.uploads.length, 2);
  assert.ok(storage.uploads.every((upload) => upload.type === 'video/mp4' && upload.bytes > 0));
  assert.deepEqual(
    storage.uploads.map((upload) => upload.path),
    [`org/job/first${PROOF_PLAYABLE_SUFFIX}`, `org/job/second${PROOF_PLAYABLE_SUFFIX}`],
  );
  assert.deepEqual(
    clips.filter((clip) => clip.reason).map((clip) => ({ id: clip.id, reason: clip.reason })),
    [
      { id: 'stub-column', reason: 'file is 12 bytes (under 1 KB)' },
      { id: 'stub-meta', reason: 'file is 40 bytes (under 1 KB)' },
      { id: 'broken', reason: 'ffmpeg died' },
    ],
  );
  assert.ok(!storage.searches.includes('tiny.webm'));

  const again = await backfillPlayableProofs(proofsAdmin(rows, storage.api), {
    runner: async () => {
      throw new Error('second pass must not transcode');
    },
  });
  assert.equal(again.built, 0);
  assert.equal(again.failed, 1);
  assert.equal(again.alreadyPlayable, 3);
  assert.equal(again.failures[0]?.id, 'broken');
});

test('backfillPlayableProofs treats a faststart MP4 as already playable and does not transcode it', async () => {
  const storage = storageDouble();
  let runnerCalls = 0;
  let fetches = 0;
  const previous = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('/org/job/ready-boot.mp4')) {
      fetches += 1;
      return new Response(Buffer.from('xxxxftypisommoov'), { status: 206 });
    }
    return previous(input, init);
  };
  try {
    const once = await backfillPlayableProofs(
      proofsAdmin(
        [{ id: 'ready', storage_path: 'org/job/ready-boot.mp4', byte_size: 4_000_000 }],
        storage.api,
      ),
      {
        runner: async () => {
          runnerCalls += 1;
          return { stdout: '', stderr: 'should not run', code: 1 };
        },
      },
    );
    const twice = await backfillPlayableProofs(
      proofsAdmin(
        [{ id: 'ready', storage_path: 'org/job/ready-boot.mp4', byte_size: 4_000_000 }],
        storage.api,
      ),
      {
        runner: async () => {
          runnerCalls += 1;
          return { stdout: '', stderr: 'should not run', code: 1 };
        },
      },
    );
    assert.equal(once.alreadyPlayable, 1);
    assert.equal(once.built, 0);
    assert.equal(once.failed, 0);
    assert.equal(twice.alreadyPlayable, 1);
    assert.equal(runnerCalls, 0);
    assert.equal(storage.uploads.length, 0);
    assert.equal(fetches, 1);
  } finally {
    globalThis.fetch = previous;
  }
});

test('backfillPlayableProofs pages every live row and honors limit', async () => {
  const rows: Row[] = Array.from({ length: 101 }, (_, index) => ({
    id: `row-${index}`,
    storage_path: null,
  }));
  const capture: { ranges: Array<[number, number]>; orders: string[] } = { ranges: [], orders: [] };
  const storage = storageDouble();
  const all = await backfillPlayableProofs(proofsAdmin(rows, storage.api, capture), {
    runner: async () => {
      throw new Error('no video to build');
    },
  });
  assert.equal(all.checked, 101);
  assert.equal(all.skipped, 101);
  assert.deepEqual(capture.ranges, [
    [0, 99],
    [100, 199],
  ]);
  assert.deepEqual(capture.orders, ['received_at', 'received_at']);

  const limitedCapture: { ranges: Array<[number, number]>; orders: string[] } = { ranges: [], orders: [] };
  const limited = await backfillPlayableProofs(proofsAdmin(rows, storage.api, limitedCapture), {
    limit: 10,
  });
  assert.equal(limited.checked, 10);
  assert.equal(limited.skipped, 10);
  assert.deepEqual(limitedCapture.ranges, [[0, 99]]);
  assert.equal(totals(limited), limited.checked);
});

test('backfillPlayableProofs rejects when the proof query fails', async () => {
  const admin = asAdmin({
    from() {
      const q = {
        select() {
          return q;
        },
        is() {
          return q;
        },
        order() {
          return q;
        },
        range() {
          return Promise.resolve({ data: null, error: { message: 'db down' } });
        },
      };
      return q;
    },
    storage: { from() { return {}; } },
  });
  await assert.rejects(() => backfillPlayableProofs(admin), /db down/);
});

test('ensureStillsAndDuration warns when the playable build fails', async () => {
  const proofId = 'proof-playable-warn-1';
  const frames = Array.from({ length: 6 }, (_, index) => ({
    id: `frame-${index}`,
    storage_path: `org/job/party/2026-09-01-after-abc123-sf${index}.jpg`,
  }));
  const admin = {
    from(table: string) {
      if (table === 'job_proofs') {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({
                    data: {
                      duration_seconds: 120,
                      byte_size: 5_000,
                      storage_path: 'org/job/party/warn-clip.webm',
                      clip_id: 'abc123',
                    },
                    error: null,
                  }),
                };
              },
            };
          },
        };
      }
      if (table === 'job_proof_frames') {
        return {
          select() {
            return {
              eq: async () => ({ data: frames, error: null }),
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    storage: {
      from() {
        return {
          async list() {
            return { data: [], error: null };
          },
          async createSignedUrl() {
            return { data: null, error: { message: 'sign denied' } };
          },
          async upload() {
            return { error: null };
          },
        };
      },
    },
  };

  const lines: string[] = [];
  const orig = console.warn;
  console.warn = (...args: unknown[]) => {
    lines.push(args.map((part) => String(part)).join(' '));
    orig.apply(console, args as [string?]);
  };
  try {
    const settled = await ensureStillsAndDuration(admin, proofId);
    assert.equal(settled.durationSeconds, 120);
    assert.match(settled.error ?? '', /sign denied/);
    assert.ok(
      lines.some((line) =>
        line.includes(`[ensureStillsAndDuration] playable build failed for ${proofId}:`) &&
        line.includes('sign denied'),
      ),
    );
  } finally {
    console.warn = orig;
  }
});
