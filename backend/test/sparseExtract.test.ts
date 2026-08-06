import test from 'node:test';
import assert from 'node:assert/strict';
import { longFormBudget, planSparseTimestamps } from '../src/shared/sparseExtract.js';
import { segmentFrames } from '../src/shared/longAnalyst.js';

/**
 * Day-length (and overnight) sampling. What earns a test is the cost ceiling:
 * a 24h file must stay a bounded number of frames and windows, never a
 * linear explosion with wall-clock time.
 */

test('a 24-hour day at two-minute candidate spacing stays under the candidate cap', () => {
  const day = 24 * 60 * 60;
  // Candidates are denser than the final keep budget; diversity filtering
  // then collapses static stretches. Cap at 720 in the extractor.
  const timestamps = planSparseTimestamps(day, { intervalSeconds: 120, maxFrames: 720 });
  // 24h / 2min = 720 natural samples — exactly the candidate ceiling.
  assert.equal(timestamps.length, 720);
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

test('a diversity-kept day (≤180 distinct frames) windows into a bounded read', () => {
  const day = 24 * 60 * 60;
  // After diversity, the keep budget is what the model sees — not candidates.
  const budget = longFormBudget({
    durationSeconds: day,
    intervalSeconds: 600,
    maxFrames: 180,
    windowMaxFrames: 12,
    windowMaxSeconds: 3600,
  });
  assert.ok(budget.frameCount <= 180);
  const windows = segmentFrames(
    budget.timestamps.map((atSeconds) => ({ atSeconds })),
    { maxFrames: 12, maxSeconds: 3600 },
  );
  assert.ok(windows.length <= 28, `expected ≤28 windows, got ${windows.length}`);
  assert.ok(windows.every((w) => w.frameIdxs.length <= 12));
});

test('zero or negative duration yields no timestamps', () => {
  assert.deepEqual(planSparseTimestamps(0, { intervalSeconds: 600, maxFrames: 180 }), []);
  assert.deepEqual(planSparseTimestamps(-10, { intervalSeconds: 600, maxFrames: 180 }), []);
});
