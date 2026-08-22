import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  extractPreviewFrameFromUrl,
  longFormBudget,
  pickPreviewFrame,
  planSparseTimestamps,
  previewAtSeconds,
} from '../src/shared/sparseExtract.js';
import { segmentFrames } from '../src/shared/longAnalyst.js';

const execFileAsync = promisify(execFile);

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

test('preview timestamp sits a quarter of the way in, never on the opening', () => {
  assert.equal(previewAtSeconds(60), 15);
  assert.equal(previewAtSeconds(4), 1);
  assert.equal(previewAtSeconds(0), 0.5);
  assert.equal(previewAtSeconds(null), 0.5);
  assert.ok(previewAtSeconds(0.8) > 0);
  assert.ok(previewAtSeconds(0.8) < 0.8);
});

test('pickPreviewFrame prefers the still closest to the preview timestamp', () => {
  const frames = [
    { atSeconds: 0, id: 'open' },
    { atSeconds: 1, id: 'early' },
    { atSeconds: 20, id: 'work' },
    { atSeconds: 59, id: 'end' },
  ];
  assert.equal(pickPreviewFrame(frames, 60)?.id, 'work');
  assert.equal(pickPreviewFrame(frames, null)?.id, 'open');
  assert.equal(pickPreviewFrame([], 60), null);
});

test('extractPreviewFrameFromUrl seeks then takes one JPEG', async () => {
  const calls: string[][] = [];
  const runner = async (_bin: string, args: string[]) => {
    calls.push(args);
    const out = args[args.length - 1];
    await writeFile(out, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    return { stdout: '', stderr: '', code: 0 };
  };
  const frame = await extractPreviewFrameFromUrl({
    url: 'https://example.test/clip.mp4',
    durationSeconds: 40,
    runner,
  });
  assert.equal(frame.atSeconds, 10);
  assert.equal(frame.jpeg[0], 0xff);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('-ss'));
  assert.ok(calls[0].includes('10'));
  assert.ok(calls[0].includes('-frames:v'));
});

test('extractPreviewFrameFromUrl pulls a real JPEG from a generated clip', async () => {
  const dir = join(tmpdir(), `atm-preview-test-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  const videoPath = join(dir, 'clip.mp4');
  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x2266aa:s=320x180:d=2:r=24',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      videoPath,
    ]);
    const frame = await extractPreviewFrameFromUrl({
      url: videoPath,
      durationSeconds: 2,
    });
    assert.ok(frame.jpeg.length > 200);
    assert.equal(frame.jpeg[0], 0xff);
    assert.equal(frame.jpeg[1], 0xd8);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
