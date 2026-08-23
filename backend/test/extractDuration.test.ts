import test from 'node:test';
import assert from 'node:assert/strict';
import {
  durationFromPacketTimes,
  durationFromProbe,
  formatVideoClock,
  parseMediaDuration,
} from '../src/verification/frames/duration.js';
import { probeMetadata, type CommandRunner } from '../src/verification/frames/extract.js';

test('parseMediaDuration: seconds, sexagesimal tags, and junk', () => {
  assert.equal(parseMediaDuration(143.2), 143.2);
  assert.equal(parseMediaDuration('96'), 96);
  assert.equal(parseMediaDuration('00:02:23.500000000'), 143.5);
  assert.equal(parseMediaDuration('2:23.5'), 143.5);
  assert.equal(parseMediaDuration('N/A'), null);
  assert.equal(parseMediaDuration('0'), null);
  assert.equal(parseMediaDuration(0), null);
  assert.equal(parseMediaDuration(Infinity), null);
  assert.equal(parseMediaDuration(null), null);
});

test('durationFromProbe: stream and Matroska tags when format.duration is missing', () => {
  assert.equal(durationFromProbe({ format: { duration: '12.5' } }), 12.5);
  assert.equal(
    durationFromProbe({
      format: {},
      streams: [{ codec_type: 'video', duration: '96.04' }],
    }),
    96.04,
  );
  assert.equal(
    durationFromProbe({
      format: { tags: { DURATION: '00:02:23.000000000' } },
      streams: [{ codec_type: 'video', tags: { DURATION: '00:02:22.800000000' } }],
    }),
    143,
  );
  assert.equal(durationFromProbe({ format: {}, streams: [] }), null);
});

test('durationFromPacketTimes: last positive pts', () => {
  assert.equal(durationFromPacketTimes('0.000000\n1.001000\n94.366667\n'), 94.366667);
  assert.equal(durationFromPacketTimes(''), null);
});

test('formatVideoClock: unknown is null, hours when needed', () => {
  assert.equal(formatVideoClock(12), '0:12');
  assert.equal(formatVideoClock(110), '1:50');
  assert.equal(formatVideoClock(4620), '1:17:00');
  assert.equal(formatVideoClock(0), null);
  assert.equal(formatVideoClock(null), null);
});

test('probeMetadata: reads stream duration when format.duration is absent', async () => {
  const runner: CommandRunner = async () => ({
    code: 0,
    stderr: '',
    stdout: JSON.stringify({
      format: {},
      streams: [
        {
          codec_type: 'video',
          codec_name: 'vp8',
          width: 1280,
          height: 720,
          avg_frame_rate: '30/1',
          duration: '87.4',
        },
      ],
    }),
  });
  const meta = await probeMetadata('clip.webm', runner);
  assert.equal(meta.durationSeconds, 87.4);
  assert.equal(meta.width, 1280);
});

test('probeMetadata: packet scan when the header has no duration', async () => {
  let calls = 0;
  const runner: CommandRunner = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        code: 0,
        stderr: '',
        stdout: JSON.stringify({ format: {}, streams: [{ codec_type: 'video' }] }),
      };
    }
    return { code: 0, stderr: '', stdout: '0.0\n12.0\n47.2\n' };
  };
  const meta = await probeMetadata('clip.webm', runner);
  assert.equal(meta.durationSeconds, 47.2);
  assert.equal(calls, 2);
});
