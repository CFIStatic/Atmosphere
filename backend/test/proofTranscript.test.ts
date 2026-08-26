import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planAudioChunks,
  queueProofTranscript,
  signedProofVideoUrl,
  wavExtractArgs,
} from '../src/audio/proofTranscript.js';

test('queueProofTranscript marks the proof queued', async () => {
  const updates: unknown[] = [];
  const admin = {
    from: () => ({
      update: (row: unknown) => {
        updates.push(row);
        return { eq: async () => ({ error: null }) };
      },
    }),
  };
  await queueProofTranscript(admin, 'proof-1');
  assert.deepEqual(updates[0], { transcript_status: 'queued' });
});

test('queueProofTranscript never throws into the upload path', async () => {
  const admin = {
    from: () => {
      throw new Error('db down');
    },
  };
  await assert.doesNotReject(() => queueProofTranscript(admin, 'proof-1'));
});

test('signedProofVideoUrl mints a URL and never downloads the film', async () => {
  const calls: string[] = [];
  const admin = {
    storage: {
      from: () => ({
        createSignedUrl: async (path: string, ttl: number) => {
          calls.push(`sign:${path}:${ttl}`);
          return { data: { signedUrl: 'https://storage.example/day-film.mp4' }, error: null };
        },
        download: async () => {
          calls.push('download');
          return { data: null, error: new Error('must not download') };
        },
      }),
    },
  };
  const url = await signedProofVideoUrl(admin, 'org/job/day.mp4');
  assert.equal(url, 'https://storage.example/day-film.mp4');
  assert.deepEqual(calls, ['sign:org/job/day.mp4:3600']);
});

test('wavExtractArgs points ffmpeg at the signed URL, not a local dump', () => {
  const args = wavExtractArgs('https://storage.example/day-film.mp4', '/tmp/speech.wav', 600);
  assert.equal(args[args.indexOf('-i') + 1], 'https://storage.example/day-film.mp4');
  assert.ok(args.includes('-t'));
  assert.ok(!args.some((arg) => arg.includes('clip.bin')));
});

test('wavExtractArgs seeks into a long film before opening the input', () => {
  const args = wavExtractArgs('https://storage.example/day-film.mp4', '/tmp/speech.wav', 600, 3600);
  assert.ok(args.indexOf('-ss') < args.indexOf('-i'));
  assert.equal(args[args.indexOf('-ss') + 1], '3600');
});

test('planAudioChunks covers a workday in 10-minute slices', () => {
  assert.deepEqual(planAudioChunks(null), []);
  assert.deepEqual(planAudioChunks(500), [0]);
  assert.deepEqual(planAudioChunks(1800), [0, 600, 1200]);
  assert.equal(planAudioChunks(24 * 60 * 60).length, 144);
  assert.equal(planAudioChunks(24 * 60 * 60 + 1).length, 144, 'a film longer than a day still stops at 24h');
});
