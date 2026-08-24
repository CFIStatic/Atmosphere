import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractJpegAtSeconds, longFormBudget, planSparseTimestamps } from '../src/shared/sparseExtract.js';
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

test('a playhead grab seeks to the requested second and returns the JPEG', async () => {
  const out = join(tmpdir(), `atm-watch-test-${Date.now()}.jpg`);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const runner = async (_bin: string, args: string[]) => {
    assert.ok(args.includes('-ss'));
    assert.ok(args.includes('3.5'));
    assert.ok(args.includes('-frames:v'));
    const dest = args[args.length - 1];
    await writeFile(dest, jpeg);
    return { stdout: '', stderr: '', code: 0 };
  };
  const grabbed = await extractJpegAtSeconds({
    url: 'https://example.test/clip.mp4',
    atSeconds: 3.5,
    runner,
  });
  assert.ok(grabbed);
  assert.deepEqual(grabbed, jpeg);
  await rm(out, { force: true }).catch(() => undefined);
});

test('a playhead grab that fails at 0:00 retries a hair later', async () => {
  const seeks: string[] = [];
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const runner = async (_bin: string, args: string[]) => {
    const seek = args[args.indexOf('-ss') + 1];
    seeks.push(seek);
    if (seek === '0') return { stdout: '', stderr: 'no keyframe', code: 1 };
    await writeFile(args[args.length - 1], jpeg);
    return { stdout: '', stderr: '', code: 0 };
  };
  const grabbed = await extractJpegAtSeconds({
    url: 'https://example.test/clip.mp4',
    atSeconds: 0,
    runner,
  });
  assert.ok(grabbed);
  assert.deepEqual(seeks, ['0', '0.4']);
});

test('short clips still get at least one sparse timestamp under a 60s preferred interval', () => {
  // A 12s guided clip must not plan zero samples when the long-form default
  // spacing is 60s — otherwise FFmpeg fps=1/60 extracts nothing.
  const timestamps = planSparseTimestamps(12, { intervalSeconds: 60, maxFrames: 180 });
  assert.ok(timestamps.length >= 1);
});
