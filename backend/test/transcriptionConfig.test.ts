import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OPENAI_TRANSCRIPTIONS_URL,
  resolveTranscriptionConfig,
  transcriptionConfigured,
} from '../src/lib/transcriptionConfig.js';
import {
  apiTranscriptWords,
  formatVerboseTranscript,
  stampClock,
  timedTranscriptFromVerbose,
  transcriptionRequestFields,
  transcriptAlreadyStamped,
} from '../src/lib/transcription.js';

test('falls back to OPENAI_API_KEY and the OpenAI transcriptions URL', () => {
  const cfg = resolveTranscriptionConfig({
    OPENAI_API_KEY: 'sk-test',
    TRANSCRIPTION_MODEL: 'gpt-4o-transcribe',
  });
  assert.equal(cfg.url, OPENAI_TRANSCRIPTIONS_URL);
  assert.equal(cfg.apiKey, 'sk-test');
  assert.equal(cfg.model, 'gpt-4o-transcribe');
  assert.equal(transcriptionConfigured(cfg), true);
});

test('explicit TRANSCRIPTION_* wins over OPENAI_API_KEY', () => {
  const cfg = resolveTranscriptionConfig({
    OPENAI_API_KEY: 'sk-openai',
    TRANSCRIPTION_URL: 'https://groq.example/v1/audio/transcriptions',
    TRANSCRIPTION_API_KEY: 'gsk-test',
    TRANSCRIPTION_MODEL: 'whisper-large-v3',
  });
  assert.equal(cfg.url, 'https://groq.example/v1/audio/transcriptions');
  assert.equal(cfg.apiKey, 'gsk-test');
  assert.equal(cfg.model, 'whisper-large-v3');
});

test('no URL and no key means captions cannot land', () => {
  const cfg = resolveTranscriptionConfig({ TRANSCRIPTION_MODEL: 'gpt-4o-transcribe' });
  assert.equal(cfg.url, '');
  assert.equal(cfg.apiKey, '');
  assert.equal(transcriptionConfigured(cfg), false);
});

test('OPENAI_BASE_URL is used when falling back', () => {
  const cfg = resolveTranscriptionConfig({
    OPENAI_API_KEY: 'sk-test',
    OPENAI_BASE_URL: 'https://api.openai.com/v1/',
  });
  assert.equal(cfg.url, OPENAI_TRANSCRIPTIONS_URL);
});

test('formatVerboseTranscript stamps segments with an offset', () => {
  const text = formatVerboseTranscript(
    {
      text: 'ignored when segments exist',
      segments: [
        { start: 0, text: 'Leave the cabinets.' },
        { start: 12.4, text: 'Understood.' },
      ],
    },
    600,
  );
  assert.equal(text, '[10:00] Leave the cabinets.\n[10:12] Understood.');
  assert.equal(transcriptAlreadyStamped(text), true);
  assert.equal(stampClock(6720), '1:52:00');
});

test('whisper asks for segment and word timestamps', () => {
  assert.deepEqual(transcriptionRequestFields('whisper-1'), {
    verbose: true,
    granularities: ['segment', 'word'],
  });
  assert.deepEqual(transcriptionRequestFields('gpt-4o-transcribe'), {
    verbose: false,
    granularities: [],
  });
});

test('timedTranscriptFromVerbose shifts word and segment clocks by the chunk offset', () => {
  const timed = timedTranscriptFromVerbose(
    {
      text: 'by bad actors',
      segments: [{ start: 0, end: 1.2, text: ' by bad actors' }],
      words: [
        { word: ' by', start: 0, end: 0.3 },
        { word: ' bad', start: 0.3, end: 0.6 },
        { word: ' actors', start: 0.6, end: 1.2 },
      ],
    },
    600,
  );
  assert.equal(timed.words[0]?.text, 'by');
  assert.equal(timed.words[0]?.start, 600);
  assert.equal(timed.words[2]?.start, 600.6);
  assert.equal(timed.segments[0]?.start, 600);
  assert.equal(timed.segments[0]?.end, 601.2);
  assert.equal(apiTranscriptWords(timed.words)?.[1]?.text, 'bad');
  assert.equal(apiTranscriptWords(null), null);
  assert.equal(apiTranscriptWords([]), null);
});
