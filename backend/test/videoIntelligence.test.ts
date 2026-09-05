import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../src/config.js';
import {
  assertProcessableDuration,
  dictatePreparedFrames,
  geminiDictationTimeoutMs,
  framesContentFingerprint,
  isLongFormVideo,
  parseDictationPayload,
  pickEvenlySpaced,
  prepareVideoFrames,
} from '../src/shared/videoIntelligence.js';
import { HttpError } from '../src/lib/errors.js';

test('isLongFormVideo follows verification.longFormSeconds', () => {
  const threshold = config.verification.longFormSeconds;
  assert.equal(isLongFormVideo(threshold - 1), false);
  assert.equal(isLongFormVideo(threshold), true);
  assert.equal(isLongFormVideo(24 * 60 * 60), true);
});

test('assertProcessableDuration rejects empty and over-max clips', () => {
  assert.throws(() => assertProcessableDuration(0), (e: unknown) => e instanceof HttpError && e.status === 400);
  assert.throws(
    () => assertProcessableDuration(config.verification.maxDurationSeconds + 1),
    (e: unknown) => e instanceof HttpError && e.status === 400,
  );
  assert.doesNotThrow(() => assertProcessableDuration(60));
  assert.doesNotThrow(() => assertProcessableDuration(config.verification.maxDurationSeconds));
});

test('pickEvenlySpaced covers ends without exceeding max', () => {
  const items = Array.from({ length: 100 }, (_, i) => i);
  const picked = pickEvenlySpaced(items, 5);
  assert.deepEqual(picked, [0, 25, 50, 74, 99]);
  assert.deepEqual(pickEvenlySpaced([1, 2, 3], 10), [1, 2, 3]);
});

test('prepareVideoFrames is source-agnostic (field_capture and media_upload share path)', async () => {
  // Fake ffmpeg: write three tiny JPEG-ish files the extractor will read.
  const runner = async (_bin: string, args: string[]) => {
    const outPattern = args[args.length - 1]!;
    const dir = outPattern.replace(/frame_%04d\.jpg$/, '');
    await mkdir(dir, { recursive: true });
    // Distinct bytes so diversity keeps more than one.
    for (let i = 1; i <= 3; i += 1) {
      const buf = Buffer.alloc(300, i * 40);
      buf.write(`frame-${i}`, 0);
      await writeFile(join(dir, `frame_000${i}.jpg`), buf);
    }
    return { stdout: '', stderr: '', code: 0 };
  };

  const a = await prepareVideoFrames(
    {
      id: 'cap-1',
      source: 'field_capture',
      url: 'https://example.test/day.mp4',
      durationSeconds: 3600,
      maxFrames: 10,
    },
    { runner },
  );
  const b = await prepareVideoFrames(
    {
      id: 'up-1',
      source: 'media_upload',
      url: 'https://example.test/other.mp4',
      durationSeconds: 3600,
      maxFrames: 10,
    },
    { runner },
  );

  assert.equal(a.source, 'field_capture');
  assert.equal(b.source, 'media_upload');
  assert.ok(a.frames.length >= 1);
  assert.ok(b.frames.length >= 1);
  assert.equal(a.longForm, true);
  // Fingerprints differ by content, not by source label.
  assert.equal(typeof framesContentFingerprint(a.frames), 'string');

  const undated = await prepareVideoFrames(
    {
      id: 'zero-1',
      source: 'field_capture',
      url: 'https://example.test/undated.webm',
      durationSeconds: 0,
      maxFrames: 8,
    },
    { runner },
  );
  assert.ok(undated.frames.length >= 1, 'unknown duration must still yield a still');
  assert.equal(undated.longForm, false);
  assert.equal(undated.durationSeconds, 0);

  // Cleanup any leftover temp dirs from failed runs is handled inside extract.
  await rm(join(tmpdir(), 'atm-sparse-unused'), { recursive: true, force: true }).catch(() => undefined);
});

test('parseDictationPayload extracts narration and a grounded action log', () => {
  const parsed = parseDictationPayload(
    JSON.stringify({
      narration: 'The crew pulls wet drywall, then sets air movers.',
      summary: 'Demo then drying.',
      actions: [
        {
          atSeconds: 14,
          action: 'remove',
          description: 'Pulling wet drywall from the south wall.',
          object: 'drywall',
          confidence: 0.9,
        },
      ],
    }),
    [0, 12, 40],
    'claude-test',
  );
  assert.equal(parsed.narration.startsWith('The crew pulls'), true);
  assert.equal(parsed.actions.length, 1);
  assert.equal(parsed.actions[0]!.action, 'remove');
  assert.equal(parsed.actions[0]!.atSeconds, 12);
  assert.equal(parsed.actions[0]!.model, 'claude-test');
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.events[0]!.atSeconds, 12);
});

test('parseDictationPayload reads event-boundary events from the model JSON', () => {
  const parsed = parseDictationPayload(
    JSON.stringify({
      narration: 'The camera starts on the ceiling, then pans to the monitors.',
      summary: 'An office desk with two screens.',
      events: [
        { t_seconds: 0, description: 'Ceiling lights and a vent.', type: 'camera' },
        { t_seconds: 8, description: 'Two monitors and a webcam.', type: 'scene' },
        { t_seconds: 18, description: 'Spreadsheet on the right screen.', type: 'activity' },
      ],
      actions: [],
    }),
    [0, 8, 18],
    'gemini-test',
  );
  assert.equal(parsed.summary, 'An office desk with two screens.');
  assert.deepEqual(
    parsed.events.map((e) => e.atSeconds),
    [0, 8, 18],
  );
  assert.match(parsed.events[2]!.text, /spreadsheet/i);
});

test('parseDictationPayload keeps a 0:00 beat extracted from timestamped prose', () => {
  const prose =
    'At 0 seconds, Tarp unclipped and rolled; harnesses on. At 48 seconds, underlayment rows mid-slope.';
  const fromBlob = parseDictationPayload(prose);
  assert.equal(fromBlob.events.length, 2);
  assert.equal(fromBlob.events[0]!.atSeconds, 0);
  assert.match(fromBlob.events[0]!.text, /tarp unclipped/i);

  const fromJson = parseDictationPayload(
    JSON.stringify({
      narration: 'Tarp unclipped and rolled; harnesses on. Then underlayment rows mid-slope.',
      events: [
        { t_seconds: 0, description: 'Tarp unclipped and rolled; harnesses on.', type: 'work' },
        { t_seconds: 48, description: 'Underlayment rows mid-slope.', type: 'work' },
      ],
    }),
  );
  assert.equal(fromJson.events.length, 2);
  assert.equal(fromJson.events[0]!.atSeconds, 0);
});

test('parseDictationPayload drops a lone t=0 catch-all that restates the summary', () => {
  const parsed = parseDictationPayload(
    JSON.stringify({
      narration:
        'At 0 seconds, the camera captures fluorescent lights, two monitors, and a spreadsheet in one long look.',
      summary: 'An office desk with two monitors and a spreadsheet.',
      events: [
        {
          t_seconds: 0,
          description:
            'The video shows fluorescent lights, two monitors, and a spreadsheet in one long look.',
          type: 'scene',
        },
      ],
      actions: [],
    }),
    [0],
    'gemini-test',
  );
  assert.equal(parsed.events.length, 0);
  assert.match(String(parsed.summary), /office desk/i);
});

test('dictatePreparedFrames uses Gemini when a Google key is set', async () => {
  const prevGoogle = process.env.GOOGLE_API_KEY;
  const prevGemini = process.env.GEMINI_API_KEY;
  const prevAnthropic = process.env.ANTHROPIC_API_KEY;
  process.env.GOOGLE_API_KEY = 'test-google';
  delete process.env.GEMINI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const originalFetch = globalThis.fetch;
  let requestBody = '';
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestBody = String(init?.body ?? '');
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    narration: 'A person sits at a desk watching a news clip on the monitor.',
                    summary: 'Desk and a news broadcast.',
                    actions: [],
                    events: [
                      { t_seconds: 8, description: 'Desk and a news broadcast on the monitor.', type: 'scene' },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;
  try {
    const result = await dictatePreparedFrames({
      id: 'clip-1',
      source: 'proof_of_work',
      durationSeconds: 64,
      longForm: false,
      frames: [{ atSeconds: 8, jpeg: Buffer.from('jpeg') }],
    });
    assert.match(result.narrationText, /desk/i);
    assert.match(result.model, /gemini/i);
    assert.match(requestBody, /event-boundary timestamps only/i);
    assert.match(requestBody, /not every 5 seconds/i);
    assert.match(requestBody, /do not emit a mandatory event at t=0/i);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0]!.atSeconds, 8);
  } finally {
    globalThis.fetch = originalFetch;
    if (prevGoogle === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = prevGoogle;
    if (prevGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGemini;
    if (prevAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevAnthropic;
  }
});

test('dictatePreparedFrames times out a hung Gemini call', async () => {
  const prevGoogle = process.env.GOOGLE_API_KEY;
  const prevGemini = process.env.GEMINI_API_KEY;
  const prevAnthropic = process.env.ANTHROPIC_API_KEY;
  const prevTimeout = process.env.GEMINI_DICTATION_TIMEOUT_MS;
  process.env.GOOGLE_API_KEY = 'test-google';
  process.env.GEMINI_DICTATION_TIMEOUT_MS = '40';
  delete process.env.GEMINI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal(geminiDictationTimeoutMs(), 40);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    assert.ok(init?.signal, 'Gemini fetch must carry an abort signal');
    throw Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
  }) as typeof fetch;
  try {
    await assert.rejects(
      () =>
        dictatePreparedFrames({
          id: 'clip-hang',
          source: 'proof_of_work',
          durationSeconds: 64,
          longForm: false,
          frames: [{ atSeconds: 8, jpeg: Buffer.from('jpeg') }],
        }),
      /timed out/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (prevGoogle === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = prevGoogle;
    if (prevGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGemini;
    if (prevAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevAnthropic;
    if (prevTimeout === undefined) delete process.env.GEMINI_DICTATION_TIMEOUT_MS;
    else process.env.GEMINI_DICTATION_TIMEOUT_MS = prevTimeout;
  }
});

test('dictatePreparedFrames sends GEMINI_API_KEY, not a Maps GOOGLE_API_KEY', async () => {
  const prevGoogle = process.env.GOOGLE_API_KEY;
  const prevGemini = process.env.GEMINI_API_KEY;
  const prevAnthropic = process.env.ANTHROPIC_API_KEY;
  process.env.GEMINI_API_KEY = 'real-gemini';
  process.env.GOOGLE_API_KEY = 'maps-restricted';
  delete process.env.ANTHROPIC_API_KEY;
  const keysTried: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string> | undefined;
    keysTried.push(headers?.['x-goog-api-key'] ?? '');
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    narration: 'A person sits at a desk watching a news clip on the monitor.',
                    summary: 'Desk and a news broadcast.',
                    actions: [],
                  }),
                },
              ],
            },
          },
        ],
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  try {
    const result = await dictatePreparedFrames({
      id: 'clip-gemini-key',
      source: 'proof_of_work',
      durationSeconds: 64,
      longForm: false,
      frames: [{ atSeconds: 8, jpeg: Buffer.from('jpeg') }],
    });
    assert.deepEqual(keysTried, ['real-gemini']);
    assert.match(result.narrationText, /desk/i);
  } finally {
    globalThis.fetch = originalFetch;
    if (prevGoogle === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = prevGoogle;
    if (prevGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGemini;
    if (prevAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevAnthropic;
  }
});

test('dictatePreparedFrames retries a retired Gemini model with the suggested id', async () => {
  const prevGoogle = process.env.GOOGLE_API_KEY;
  const prevGemini = process.env.GEMINI_API_KEY;
  const prevAnthropic = process.env.ANTHROPIC_API_KEY;
  process.env.GEMINI_API_KEY = 'real-gemini';
  delete process.env.GOOGLE_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const urls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (!url.includes('gemini-3.6-flash-retry')) {
      return new Response(
        JSON.stringify({
          error: {
            code: 404,
            message:
              'This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.6-flash-retry for the latest features and improvements.',
            status: 'NOT_FOUND',
          },
        }),
        { status: 404 },
      );
    }
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    narration: 'A person sits at a desk watching a news clip on the monitor.',
                    summary: 'Desk and a news broadcast.',
                    actions: [],
                  }),
                },
              ],
            },
          },
        ],
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  try {
    const result = await dictatePreparedFrames({
      id: 'clip-retired-model',
      source: 'proof_of_work',
      durationSeconds: 64,
      longForm: false,
      frames: [{ atSeconds: 8, jpeg: Buffer.from('jpeg') }],
    });
    assert.equal(urls.length, 2);
    assert.match(urls[1]!, /gemini-3\.6-flash-retry/);
    assert.match(result.narrationText, /desk/i);
    assert.equal(result.model, 'gemini-3.6-flash-retry');
  } finally {
    globalThis.fetch = originalFetch;
    if (prevGoogle === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = prevGoogle;
    if (prevGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGemini;
    if (prevAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevAnthropic;
  }
});
