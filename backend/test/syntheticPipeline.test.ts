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
  createTwin,
  resetGeometryStoreForTests,
} from '../src/geometry/store.js';
import { ingestMeasurementsOntoTwin, summarizeTwin } from '../src/geometry/twin.js';
import {
  makeSyntheticDayClip,
  probeHasAudio,
  probeHasVideo,
} from './helpers/syntheticAv.js';

process.env.MEDIA_STORE = 'memory';
process.env.GEOMETRY_STORE = 'memory';

test('synthetic fixture contains video + audio tracks', async () => {
  const clip = await makeSyntheticDayClip({ durationSeconds: 8, withAudio: true });
  assert.equal(await probeHasVideo(clip.path), true);
  assert.equal(await probeHasAudio(clip.path), true);
});

test('synthetic silent fixture has video but no audio', async () => {
  const clip = await makeSyntheticDayClip({
    durationSeconds: 6,
    withAudio: false,
    name: 'silent-6s.mp4',
  });
  assert.equal(await probeHasVideo(clip.path), true);
  assert.equal(await probeHasAudio(clip.path), false);
});

test('sparse extract reads frames from a real synthetic MP4 via ffmpeg', async () => {
  const clip = await makeSyntheticDayClip({ durationSeconds: 10, withAudio: true });
  const frames = await extractSparseFramesFromUrl({
    url: clip.path, // ffmpeg accepts a local path
    durationSeconds: clip.durationSeconds,
    maxFrames: 8,
    candidateIntervalSeconds: 60,
  });
  assert.ok(frames.length >= 1, 'expected at least one JPEG from the clip');
  assert.ok(frames[0]!.jpeg.length > 100);
});

test('prepareVideoFrames works on synthetic day film (source-agnostic)', async () => {
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
});

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

test('twin ingest from synthetic measure + video ref is metric and ready', async () => {
  resetGeometryStoreForTests();
  const twin = await createTwin({
    orgId: 'org-synth',
    jobId: 'job-synth',
    label: 'Synthetic site',
    primarySource: 'roomplan',
  });
  const updated = await ingestMeasurementsOntoTwin(twin.id, {
    source: 'roomplan',
    rooms: [
      { name: 'Room A', lengthFt: 12, widthFt: 10, heightFt: 8, confidence: 0.9 },
      { name: 'Room B', floorAreaSqFt: 80, heightFt: 8 },
    ],
    videoRef: 'media-synth-day-1',
    work: [{ label: 'Demo flood cut', status: 'done' }],
  });
  const summary = summarizeTwin(updated);
  assert.equal(summary.metric, true);
  assert.equal(summary.roomCount, 2);
  assert.equal(summary.videoCount, 1);
  assert.equal(summary.status, 'ready');
});
