import test from 'node:test';
import assert from 'node:assert/strict';
import { longFormBudget, planSparseTimestamps } from '../src/shared/sparseExtract.js';
import { segmentFrames } from '../src/shared/longAnalyst.js';

/**
 * Day-length (and overnight) sampling. What earns a test is the cost ceiling:
 * a 24h file must stay a bounded number of frames and windows, never a
 * linear explosion with wall-clock time.
 */

test('a 24-hour day at ten-minute spacing stays under the frame budget', () => {
  const day = 24 * 60 * 60;
  const timestamps = planSparseTimestamps(day, { intervalSeconds: 600, maxFrames: 180 });
  // 24h / 10min = 144 natural samples — under the 180 cap.
  assert.equal(timestamps.length, 144);
  assert.ok(timestamps[0] > 0);
  assert.ok(timestamps[timestamps.length - 1] < day);
  // Strictly increasing.
  for (let i = 1; i < timestamps.length; i += 1) {
    assert.ok(timestamps[i] > timestamps[i - 1]);
  }
});

test('an over-dense interval is widened so maxFrames is the hard ceiling', () => {
  const day = 24 * 60 * 60;
  // 60s spacing would be 1440 frames; the cap must win.
  const timestamps = planSparseTimestamps(day, { intervalSeconds: 60, maxFrames: 180 });
  assert.equal(timestamps.length, 180);
});

test('a 24-hour sparse sample windows into a bounded long-form read', () => {
  const day = 24 * 60 * 60;
  const budget = longFormBudget({
    durationSeconds: day,
    intervalSeconds: 600,
    maxFrames: 180,
    windowMaxFrames: 12,
    windowMaxSeconds: 3600,
  });
  assert.equal(budget.frameCount, 144);
  const windows = segmentFrames(
    budget.timestamps.map((atSeconds) => ({ atSeconds })),
    { maxFrames: 12, maxSeconds: 3600 },
  );
  // ~144 frames / ~6 per hour-long window ≈ 24 cheap calls + one synthesis.
  assert.ok(windows.length <= 28, `expected ≤28 windows, got ${windows.length}`);
  assert.ok(windows.length >= 20, `expected a full day of windows, got ${windows.length}`);
  assert.ok(windows.every((w) => w.frameIdxs.length <= 12));
});

test('zero or negative duration yields no timestamps', () => {
  assert.deepEqual(planSparseTimestamps(0, { intervalSeconds: 600, maxFrames: 180 }), []);
  assert.deepEqual(planSparseTimestamps(-10, { intervalSeconds: 600, maxFrames: 180 }), []);
});
