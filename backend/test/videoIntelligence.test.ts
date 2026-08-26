import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../src/config.js';
import {
  assertProcessableDuration,
  dictatePreparedFrames,
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
});

test('dictatePreparedFrames uses Gemini when a Google key is set', async () => {
  const prevGoogle = process.env.GOOGLE_API_KEY;
  const prevGemini = process.env.GEMINI_API_KEY;
  const prevAnthropic = process.env.ANTHROPIC_API_KEY;
  process.env.GOOGLE_API_KEY = 'test-google';
  delete process.env.GEMINI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
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
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as typeof fetch;
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
