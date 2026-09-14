import test from 'node:test';
import assert from 'node:assert/strict';
import { fuseVisionTranscriptEvidence } from '../src/audio/evidenceFusion.js';
import type { EvidenceLogEntry } from '../src/audio/evidenceLog.js';

function restoreEnv(name: string, previous: string | undefined) {
  if (previous === undefined) delete process.env[name];
  else process.env[name] = previous;
}

test('fuseVisionTranscriptEvidence no-ops without both modalities', async () => {
  const base: EvidenceLogEntry[] = [{ atSeconds: 8, text: 'Hallway doorway.', type: 'scene' }];
  const prevAnthropic = process.env.ANTHROPIC_API_KEY;
  const prevGemini = process.env.GEMINI_API_KEY;
  const prevGoogle = process.env.GOOGLE_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  try {
    const onlyVision = await fuseVisionTranscriptEvidence({
      entries: base,
      narrationText: 'Crew at vanity.',
      transcript: null,
    });
    assert.deepEqual(onlyVision, base);

    process.env.GEMINI_API_KEY = 'live-gemini';
    const onlySpeech = await fuseVisionTranscriptEvidence({
      entries: base,
      narrationText: null,
      transcript: '[0:18] Homeowner: leave the cabinets.',
    });
    assert.deepEqual(onlySpeech, base);
  } finally {
    restoreEnv('ANTHROPIC_API_KEY', prevAnthropic);
    restoreEnv('GEMINI_API_KEY', prevGemini);
    restoreEnv('GOOGLE_API_KEY', prevGoogle);
  }
});

test('fuseVisionTranscriptEvidence merges Analysis-mode fused beats', async () => {
  const prevAnthropic = process.env.ANTHROPIC_API_KEY;
  const prevGemini = process.env.GEMINI_API_KEY;
  const prevGoogle = process.env.GOOGLE_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  process.env.GEMINI_API_KEY = 'live-gemini';

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    assert.match(String(input), /gemini-2\.5-pro:generateContent/);
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    entries: [
                      {
                        atSeconds: 48,
                        text: 'Homeowner refuses cabinet replacement while crew works at vanity.',
                        type: 'decision',
                        quote: 'I do not want you to replace the cabinets',
                        confidence: 0.82,
                      },
                    ],
                  }),
                },
              ],
            },
          },
        ],
        modelVersion: 'gemini-2.5-pro',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;

  try {
    const base: EvidenceLogEntry[] = [
      { atSeconds: 8, text: 'Hallway doorway.', type: 'scene' },
      { atSeconds: 48, text: 'Crew at the vanity.', type: 'work' },
    ];
    const merged = await fuseVisionTranscriptEvidence({
      entries: base,
      narrationText: 'Crew remounts mirror at vanity. Cabinets untouched.',
      summary: 'Vanity work in progress.',
      transcript:
        '[0:18] Homeowner: I do not want you to replace the cabinets unless insurance approves it.\n' +
        '[1:36] Contractor: Understood. We will remount the mirror today.',
      durationSeconds: 200,
    });
    assert.ok(merged.length >= 3);
    assert.ok(
      merged.some((e) => e.kind === 'fusion' && /cabinet/i.test(e.text)),
      'fused decision beat present',
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv('ANTHROPIC_API_KEY', prevAnthropic);
    restoreEnv('GEMINI_API_KEY', prevGemini);
    restoreEnv('GOOGLE_API_KEY', prevGoogle);
  }
});
