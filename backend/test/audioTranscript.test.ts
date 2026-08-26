import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  planAudioChunks,
  segmentsFromWhisperBody,
  speechEvidenceSummary,
  isSpeechQuestion,
  serializeSpeech,
} from '../src/audio/transcript.js';
import { extractAudioChunk, probeAudioTrack } from '../src/audio/extract.js';
import { transcribeVideoFromSource } from '../src/audio/run.js';
import { ffmpegAvailable, makeSyntheticDayClip } from './helpers/syntheticAv.js';

test('planAudioChunks splits a workday into capped windows', () => {
  const chunks = planAudioChunks(7 * 3600, { chunkSeconds: 600, maxChunks: 150 });
  assert.equal(chunks.length, 42);
  assert.equal(chunks[0]?.startSeconds, 0);
  assert.equal(chunks[0]?.durationSeconds, 600);
  assert.equal(chunks[41]?.startSeconds, 41 * 600);
  assert.ok((chunks[41]?.durationSeconds ?? 0) > 0);
});

test('planAudioChunks refuses empty or tiny durations', () => {
  assert.deepEqual(planAudioChunks(0), []);
  assert.deepEqual(planAudioChunks(-4), []);
});

test('segmentsFromWhisperBody offsets chunk time onto the day timeline', () => {
  const segments = segmentsFromWhisperBody(
    {
      text: 'Tarp is gone.',
      segments: [
        { start: 12.2, end: 18.4, text: '  Tarp is gone. ', avg_logprob: -0.2, no_speech_prob: 0.1 },
      ],
    },
    { index: 2, startSeconds: 1200, durationSeconds: 600 },
  );
  assert.equal(segments.length, 1);
  assert.equal(segments[0]?.startSeconds, 1212.2);
  assert.equal(segments[0]?.endSeconds, 1218.4);
  assert.equal(segments[0]?.text, 'Tarp is gone.');
  assert.equal(segments[0]?.chunkIndex, 2);
  assert.ok((segments[0]?.confidence ?? 0) > 0.7);
});

test('segmentsFromWhisperBody drops high no-speech and falls back to text', () => {
  const silent = segmentsFromWhisperBody(
    { segments: [{ start: 0, end: 10, text: 'noise', no_speech_prob: 0.99 }] },
    { index: 0, startSeconds: 0, durationSeconds: 10 },
  );
  assert.deepEqual(silent, []);

  const fallback = segmentsFromWhisperBody(
    { text: 'We pulled the wet drywall.' },
    { index: 0, startSeconds: 60, durationSeconds: 30 },
  );
  assert.equal(fallback[0]?.startSeconds, 60);
  assert.equal(fallback[0]?.text, 'We pulled the wet drywall.');
});

test('speechEvidenceSummary labels every line as a proposal, not a verdict', () => {
  const lines = speechEvidenceSummary([
    {
      startSeconds: 14,
      endSeconds: 22,
      text: 'Drywall is finished in the bath.',
      confidence: 0.9,
      noSpeechProb: 0.1,
      chunkIndex: 0,
    },
  ]);
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /proposal only/);
  assert.match(lines[0]!, /not proof of completion/);
  assert.match(lines[0]!, /Drywall is finished/);
  assert.match(lines[0]!, /@ 14s/);
});

test('isSpeechQuestion distinguishes say/hear from did-they-do-it', () => {
  assert.equal(isSpeechQuestion('What did they say about the skylight?'), true);
  assert.equal(isSpeechQuestion('Did they replace the water heater?'), false);
});

test('serializeSpeech is the office payload shape', () => {
  const payload = serializeSpeech([
    {
      startSeconds: 14,
      endSeconds: 22,
      text: 'Tarp is gone.',
      confidence: 0.8,
      noSpeechProb: 0.05,
      chunkIndex: 0,
    },
  ]);
  assert.deepEqual(payload, [
    { atSeconds: 14, endSeconds: 22, text: 'Tarp is gone.', confidence: 0.8 },
  ]);
});

test('ffmpeg extracts a wav chunk from a synthetic A/V clip', { skip: !ffmpegAvailable() }, async () => {
  const clip = await makeSyntheticDayClip({ durationSeconds: 4, name: 'transcript-av.mp4' });
  const probe = await probeAudioTrack(clip.path);
  assert.equal(probe.hasAudio, true);

  const out = `${clip.path}.chunk.wav`;
  await extractAudioChunk({
    source: clip.path,
    startSeconds: 0,
    durationSeconds: 2,
    outPath: out,
  });
  const bytes = await readFile(out);
  assert.ok(bytes.length > 100, 'extracted wav should have bytes');
});

test('transcribeVideoFromSource timestamps mocked speech onto the day film', { skip: !ffmpegAvailable() }, async () => {
  const clip = await makeSyntheticDayClip({ durationSeconds: 4, name: 'transcript-run.mp4' });
  const result = await transcribeVideoFromSource({
    source: clip.path,
    durationSeconds: 4,
    chunkSeconds: 2,
    maxChunks: 4,
    transcribe: async () => ({
      text: 'Crew pulling drywall.',
      segments: [{ start: 0.2, end: 1.1, text: 'Crew pulling drywall.' }],
    }),
  });
  assert.equal(result.hasAudio, true);
  assert.ok(result.segments.length >= 1);
  assert.equal(result.segments[0]?.text, 'Crew pulling drywall.');
  assert.ok((result.segments[0]?.startSeconds ?? -1) >= 0);
});
