import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSparseFramesFromUrl } from '../src/shared/sparseExtract.js';
import { prepareVideoFrames } from '../src/shared/videoIntelligence.js';
import {
  beginMediaUpload,
  completeMediaUpload,
  resetMediaCatalogForTests,
} from '../src/media/catalog.js';
import { MemoryMediaStorage } from '../src/media/driver.js';
import {
  ffmpegAvailable,
  makeSyntheticDayClip,
  probeHasAudio,
  probeHasVideo,
} from './helpers/syntheticAv.js';

process.env.MEDIA_STORE = 'memory';

const hasFfmpeg = ffmpegAvailable();

test('synthetic fixture contains video + audio tracks', { skip: !hasFfmpeg }, async () => {
  const clip = await makeSyntheticDayClip({ durationSeconds: 8, withAudio: true });
  assert.equal(await probeHasVideo(clip.path), true);
  assert.equal(await probeHasAudio(clip.path), true);
});

test('synthetic silent fixture has video but no audio', { skip: !hasFfmpeg }, async () => {
  const clip = await makeSyntheticDayClip({
    durationSeconds: 6,
    withAudio: false,
    name: 'silent-6s.mp4',
  });
  assert.equal(await probeHasVideo(clip.path), true);
  assert.equal(await probeHasAudio(clip.path), false);
});

test(
  'sparse extract reads frames from a real synthetic MP4 via ffmpeg',
  { skip: !hasFfmpeg },
  async () => {
    const clip = await makeSyntheticDayClip({ durationSeconds: 10, withAudio: true });
    const frames = await extractSparseFramesFromUrl({
      url: clip.path, // ffmpeg accepts a local path
      durationSeconds: clip.durationSeconds,
      maxFrames: 8,
      candidateIntervalSeconds: 60,
    });
    assert.ok(frames.length >= 1, 'expected at least one JPEG from the clip');
    assert.ok(frames[0]!.jpeg.length > 100);
  },
);

test(
  'prepareVideoFrames works on synthetic day film (source-agnostic)',
  { skip: !hasFfmpeg },
  async () => {
    const clip = await makeSyntheticDayClip({ durationSeconds: 10, withAudio: true });
    const prepared = await prepareVideoFrames({
      id: 'synth-1',
      source: 'field_capture',
      url: clip.path,
      durationSeconds: clip.durationSeconds,
      maxFrames: 12,
    });
    assert.equal(prepared.source, 'field_capture');
    assert.ok(prepared.frames.length >= 1);
  },
);

test(
  'a short clip reported as 60s still yields a frame (interval was longer than the file)',
  { skip: !hasFfmpeg },
  async () => {
    const clip = await makeSyntheticDayClip({
      durationSeconds: 2,
      withAudio: false,
      name: 'short-2s-as-60.mp4',
    });
    const frames = await extractSparseFramesFromUrl({
      url: clip.path,
      durationSeconds: 60,
      maxFrames: 8,
      candidateIntervalSeconds: 120,
    });
    assert.ok(frames.length >= 1, 'fps=1/30 on a 2s file must fall back to a still');
  },
);

test(
  'a clip with unknown duration still yields a frame for the model',
  { skip: !hasFfmpeg },
  async () => {
    const clip = await makeSyntheticDayClip({
      durationSeconds: 2,
      withAudio: false,
      name: 'short-2s-undated.mp4',
    });
    const prepared = await prepareVideoFrames({
      id: 'undated-1',
      source: 'field_capture',
      url: clip.path,
      durationSeconds: 0,
      maxFrames: 8,
    });
    assert.ok(prepared.frames.length >= 1, '0:00 recordings must still be readable');
  },
);

test('media catalog accepts A/V day film and rejects silent field_day_video', async () => {
  resetMediaCatalogForTests();
  const driver = new MemoryMediaStorage();

  const ok = await beginMediaUpload({
    orgId: 'org-synth',
    kind: 'field_day_video',
    contentType: 'video/mp4',
    durationSeconds: 8,
    byteSize: 120_000,
    hasAudio: true,
    driver,
  });
  const ready = await completeMediaUpload({
    orgId: 'org-synth',
    sessionId: ok.session.id,
    byteSize: 120_000,
    durationSeconds: 8,
    hasAudio: true,
    contentHash: 'synthhash01234567',
  });
  assert.equal(ready.state, 'ready');
  assert.equal(ready.hasAudio, true);

  await assert.rejects(
    () =>
      beginMediaUpload({
        orgId: 'org-synth',
        kind: 'field_day_video',
        contentType: 'video/mp4',
        durationSeconds: 8,
        hasAudio: false,
        driver,
      }),
    (e: unknown) => e instanceof Error && (e as { code?: string }).code === 'audio_required',
  );
});
