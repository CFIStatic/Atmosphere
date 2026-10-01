import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ROOM_BACKFILL_BOOT_DELAY_MS,
  ROOM_BACKFILL_BOOT_LIMIT,
  clipRoomBackfillOnBootEnabled,
  scheduleClipRoomBackfill,
} from '../src/lib/backfillClipRooms.js';

test('clipRoomBackfillOnBootEnabled is on unless the env is exactly 0', () => {
  assert.equal(clipRoomBackfillOnBootEnabled({ PROOF_ROOM_BACKFILL_ON_BOOT: '0' }), false);
  assert.equal(clipRoomBackfillOnBootEnabled({}), true);
  assert.equal(clipRoomBackfillOnBootEnabled({ PROOF_ROOM_BACKFILL_ON_BOOT: '1' }), true);
  assert.equal(ROOM_BACKFILL_BOOT_DELAY_MS, 60_000);
  assert.equal(ROOM_BACKFILL_BOOT_LIMIT, 200);
});

test('scheduleClipRoomBackfill does not arm a timer when the env gate is off', () => {
  let armed = false;
  const scheduled = scheduleClipRoomBackfill({
    env: { PROOF_ROOM_BACKFILL_ON_BOOT: '0' },
    setTimer: () => {
      armed = true;
    },
  });
  assert.equal(scheduled, false);
  assert.equal(armed, false);
});

test('scheduleClipRoomBackfill logs counts after boot without blocking startup', async () => {
  const logs: string[] = [];
  let ran = false;
  let fire: (() => Promise<void>) | null = null;
  const scheduled = scheduleClipRoomBackfill({
    env: {},
    getAdmin: () => ({}) as never,
    log: (line) => logs.push(line),
    setTimer: (fn, delayMs) => {
      assert.equal(delayMs, 60_000);
      fire = fn;
    },
    run: async (_admin, opts) => {
      ran = true;
      assert.equal(opts?.apply, true);
      assert.equal(opts?.limit, 200);
      return { scanned: 3, written: 2, skipped: 1, failed: 0, failures: [] };
    },
  });
  assert.equal(scheduled, true);
  assert.equal(ran, false);
  assert.ok(fire);
  await fire!();
  assert.deepEqual(logs, ['[room-backfill] {"scanned":3,"written":2,"skipped":1,"failed":0}']);
});

test('scheduleClipRoomBackfill never rejects when admin, the run, or the logger fails', async () => {
  const logs: string[] = [];
  const arm = async (opts: Parameters<typeof scheduleClipRoomBackfill>[0]) => {
    let fire: (() => Promise<void>) | null = null;
    const scheduled = scheduleClipRoomBackfill({
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
  assert.equal(logs.at(-1), '[room-backfill] skipped: no admin client');

  await arm({
    getAdmin: () => ({}) as never,
    run: async () => {
      throw new Error('function proofs_awaiting_room_backfill does not exist');
    },
  });
  assert.equal(logs.at(-1), '[room-backfill] aborted: function proofs_awaiting_room_backfill does not exist');

  await arm({
    getAdmin: () => {
      throw new Error('admin exploded');
    },
    log: () => {
      throw new Error('log sink down');
    },
    run: async () => {
      throw new Error('still running');
    },
  });
});

test('index starts the room backfill inside the sold-path worker block', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/index.ts'), 'utf8');
  const blockStart = src.indexOf('if (runSoldPathWorkers)');
  assert.ok(blockStart >= 0);
  const block = src.slice(blockStart, src.indexOf('});', blockStart));
  const sweepAt = block.indexOf('startProofAnalysisSweep()');
  const roomAt = block.indexOf('scheduleClipRoomBackfill()');
  assert.ok(sweepAt >= 0);
  assert.ok(roomAt > sweepAt);
  assert.match(src, /stopClipRoomBackfill\(\)/);
  assert.doesNotMatch(src.slice(0, blockStart), /scheduleClipRoomBackfill\(\)/);
});
