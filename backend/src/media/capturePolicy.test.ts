import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PREFERRED_DAY_FILM,
  kindRequiresAudio,
  assertAudiovisualPolicy,
} from './capturePolicy.js';
import { HttpError } from '../lib/errors.js';

test('PREFERRED_DAY_FILM caps day film at ~720p / ~2 Mbps with A/V', () => {
  assert.equal(PREFERRED_DAY_FILM.maxWidth, 1280);
  assert.equal(PREFERRED_DAY_FILM.maxHeight, 720);
  assert.equal(PREFERRED_DAY_FILM.videoBitsPerSecond, 2_000_000);
  assert.equal(PREFERRED_DAY_FILM.frameRateIdeal, 30);
  assert.equal(PREFERRED_DAY_FILM.frameRateMin, 24);

  assert.equal(PREFERRED_DAY_FILM.ios.captureAudio, true);
  assert.equal(PREFERRED_DAY_FILM.ios.sessionPreset, 'hd1280x720');
  assert.equal(PREFERRED_DAY_FILM.ios.videoBitsPerSecond, 2_000_000);
  assert.equal(PREFERRED_DAY_FILM.ios.frameRate, 30);

  assert.equal(PREFERRED_DAY_FILM.web.getUserMedia.audio, true);
  assert.equal(PREFERRED_DAY_FILM.web.videoBitsPerSecond, 2_000_000);
  const video = PREFERRED_DAY_FILM.web.getUserMedia.video;
  assert.equal(video.width.ideal, 1280);
  assert.equal(video.width.max, 1280);
  assert.equal(video.height.ideal, 720);
  assert.equal(video.height.max, 720);
  assert.equal(video.frameRate.ideal, 30);
  assert.equal(video.frameRate.max, 30);
  assert.ok(PREFERRED_DAY_FILM.web.mimeCandidates.some((m) => m.includes('opus') || m.includes('mp4')));
});

test('field day and proof kinds require a microphone track', () => {
  assert.equal(kindRequiresAudio('field_day_video'), true);
  assert.equal(kindRequiresAudio('proof_video'), true);
  assert.equal(kindRequiresAudio('proof_frame'), false);
});

test('assertAudiovisualPolicy rejects silent day film', () => {
  assert.doesNotThrow(() =>
    assertAudiovisualPolicy({ kind: 'field_day_video', hasAudio: true }),
  );
  assert.throws(
    () => assertAudiovisualPolicy({ kind: 'field_day_video', hasAudio: false }),
    (err: unknown) => err instanceof HttpError && err.code === 'audio_required',
  );
});
