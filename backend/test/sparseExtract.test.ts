import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  extractSparseFramesFromUrl,
  longFormBudget,
  planSparseTimestamps,
} from '../src/shared/sparseExtract.js';
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

test('short clips still get at least one sparse timestamp under a 60s preferred interval', () => {
  // A 12s guided clip must not plan zero samples when the long-form default
  // spacing is 60s — otherwise FFmpeg fps=1/60 extracts nothing.
  const timestamps = planSparseTimestamps(12, { intervalSeconds: 60, maxFrames: 180 });
  assert.ok(timestamps.length >= 1);
});

async function writeJpeg(args: string[], bytes: Buffer): Promise<void> {
  const outPattern = args[args.length - 1]!;
  const dir = outPattern.replace(/frame_%04d\.jpg$/, '');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'frame_0001.jpg'), bytes);
}

test('unknown duration still extracts the first decoded still', async () => {
  const runner = async (_bin: string, args: string[]) => {
    assert.equal(args.includes('fps=1'), true, 'unknown duration walks at 1 fps');
    await writeJpeg(args, Buffer.from('still-zero-duration'));
    return { stdout: '', stderr: '', code: 0 };
  };
  const frames = await extractSparseFramesFromUrl({
    url: 'https://example.test/undated.webm',
    durationSeconds: 0,
    maxFrames: 8,
    runner,
  });
  assert.equal(frames.length, 1);
  assert.equal(frames[0]!.jpeg.toString(), 'still-zero-duration');
});

test('interval extract that writes nothing falls back to the first decoded frame', async () => {
  let calls = 0;
  const runner = async (_bin: string, args: string[]) => {
    calls += 1;
    const vf = args[args.indexOf('-vf') + 1];
    if (calls === 1) {
      assert.match(String(vf), /^fps=1\//);
      return { stdout: '', stderr: '', code: 0 };
    }
    await writeJpeg(args, Buffer.from('first-frame-fallback'));
    return { stdout: '', stderr: '', code: 0 };
  };
  const frames = await extractSparseFramesFromUrl({
    url: 'https://example.test/short.webm',
    durationSeconds: 60,
    maxFrames: 8,
    candidateIntervalSeconds: 120,
    runner,
  });
  assert.ok(calls >= 2, `expected a fallback after empty interval extract, got ${calls} calls`);
  assert.equal(frames.length, 1);
  assert.equal(frames[0]!.jpeg.toString(), 'first-frame-fallback');
});
