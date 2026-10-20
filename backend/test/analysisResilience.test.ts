/**
 * Regression tests for the Oct 19 2026 "Needs attention" videos:
 *  - escalation fell back to Gemini with a Claude model id (404) and failed the video;
 *  - one evidence box in pixel coords failed schema validation and failed the video;
 *  - narration sent 131 images to Anthropic (limit 100);
 *  - the library said "Analyzed" while verification_videos.status was failed.
 * Every provider is mocked; nothing touches a real API or database.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GeminiVisionAnalyzer,
  createAnalyzeFramesHandler,
  type AnalysisResult,
  type VisionAnalyzer,
} from '../src/verification/ai/analyzer.js';
import { frameObservationSchema, normalizeEvidenceRegions, type FrameObservationParsed } from '../src/verification/schemas.js';
import { verificationConfig } from '../src/verification/config.js';
import { assertModelForProvider, modelFamily, modelForProvider } from '../src/lib/modelProviderGuard.js';
import { capNarrationFrames, MAX_NARRATION_FRAMES } from '../src/shared/liveNarrator.js';
import { clipStatusOfProof } from '../src/shared/clipStatusOfProof.js';
import { analysisStateOf } from '../src/verifier/library.js';

const OBS = {
  room_type: 'office',
  observed_conditions: [],
  damage_types: [],
  work_activities: [],
  materials_present: [],
  equipment_present: [],
  completion_indicators: [],
  safety_issues: [],
  visible_text: [],
  uncertainty_reasons: [],
  confidence: 0.2,
  evidence_regions: [],
};

function geminiReply(obj: unknown) {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      responseId: 'r',
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

/* ---------- 1. provider/model guard ---------- */

test('modelFamily recognises each provider', () => {
  assert.equal(modelFamily('claude-haiku-4-5'), 'anthropic');
  assert.equal(modelFamily('gemini-3.1-pro-preview'), 'google');
  assert.equal(modelFamily('models/gemini-3.5-flash-lite'), 'google');
  assert.equal(modelFamily('gpt-5'), 'openai');
});

test('modelForProvider never returns another provider’s id', () => {
  assert.equal(modelForProvider('google', 'claude-haiku-4-5', 'gemini-3.1-pro-preview'), 'gemini-3.1-pro-preview');
  assert.equal(modelForProvider('google', 'gemini-3.6-flash', 'gemini-3.1-pro-preview'), 'gemini-3.6-flash');
  assert.throws(() => modelForProvider('google', 'claude-x', 'claude-y'));
  assert.throws(() => assertModelForProvider('google', 'claude-haiku-4-5'));
  assert.throws(() => assertModelForProvider('anthropic', 'gemini-3.1-pro-preview'));
});

test('escalation Gemini fallback sends a Gemini model, not the Claude escalation id', async () => {
  const prevKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY; // force the Anthropic leg to fail → Gemini fallback
  const urls: string[] = [];
  try {
    const analyzer = new GeminiVisionAnalyzer({
      apiKey: 'k',
      baseUrl: 'http://mock.local',
      fetchFn: (async (url: string) => {
        urls.push(String(url));
        return geminiReply(OBS);
      }) as unknown as typeof fetch,
    });
    const result = await analyzer.escalateAnalysis([{ mimeType: 'image/jpeg', base64: 'aGk=' }], 'low');
    assert.equal(result.provider, 'google');
    assert.equal(modelFamily(result.modelName), 'google');
    assert.equal(urls.length, 1);
    assert.ok(!/claude/i.test(urls[0]), `Gemini must not receive a Claude id: ${urls[0]}`);
  } finally {
    if (prevKey !== undefined) process.env.ANTHROPIC_API_KEY = prevKey;
  }
});

test('Gemini analyzer refuses a Claude model id before any network call', async () => {
  let called = false;
  const analyzer = new GeminiVisionAnalyzer({
    apiKey: 'k',
    baseUrl: 'http://mock.local',
    fetchFn: (async () => {
      called = true;
      return geminiReply(OBS);
    }) as unknown as typeof fetch,
  });
  const prev = verificationConfig.primaryModel;
  (verificationConfig as { primaryModel: string }).primaryModel = 'claude-haiku-4-5';
  try {
    await assert.rejects(analyzer.analyzeFrame({ mimeType: 'image/jpeg', base64: 'aGk=' }), /Refusing/);
    assert.equal(called, false);
  } finally {
    (verificationConfig as { primaryModel: string }).primaryModel = prev;
  }
});

/* ---------- 2. evidence regions ---------- */

test('evidence regions: the production reply (pixel / 0-1000 boxes) parses instead of failing', () => {
  const parsed = frameObservationSchema.parse({
    ...OBS,
    evidence_regions: [{ label: 'desk', x: 120, y: 340, width: 400, height: 250 }],
  });
  assert.equal(parsed.evidence_regions.length, 1);
  const r = parsed.evidence_regions[0];
  for (const v of [r.x, r.y, r.width, r.height]) assert.ok(v >= 0 && v <= 1);
  assert.ok(Math.abs(r.x - 0.12) < 1e-9);
});

test('evidence regions: known frame size divides pixels; clamps; drops invalid', () => {
  const out = normalizeEvidenceRegions(
    [
      { x: 960, y: 540, width: 960, height: 540 }, // pixels on 1920x1080
      { x: 0.9, y: 0.9, width: 0.5, height: 0.5 }, // overflows frame → clamped
      { x: 'a', y: 0, width: 1, height: 1 }, // non-numeric → dropped
      { x: 0.1, y: 0.1, width: 0, height: 0.2 }, // no area → dropped
      { x: -0.2, y: 0.1, width: 0.5, height: 0.2 }, // negative → clamped
    ],
    { width: 1920, height: 1080 },
  ) as Array<{ x: number; y: number; width: number; height: number }>;
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], { x: 0.5, y: 0.5, width: 0.5, height: 0.5 });
  assert.ok(Math.abs(out[1].width - 0.1) < 1e-9 && Math.abs(out[1].height - 0.1) < 1e-9);
  assert.equal(out[2].x, 0);
  assert.equal(normalizeEvidenceRegions(null).constructor, Array);
});

/* ---------- 3. library label ---------- */

test('library label: failed verification_videos.status shows Needs attention', () => {
  const proof = { state: 'analysed', analysis_status: 'done', narration_status: 'done', ai_summary: 'x' };
  assert.equal(clipStatusOfProof(proof).label, 'Analyzed');
  assert.equal(clipStatusOfProof({ ...proof, verification_status: 'failed' }).label, 'Needs attention');
  assert.equal(clipStatusOfProof({ ...proof, verification_status: 'completed' }).label, 'Analyzed');
  assert.equal(
    analysisStateOf({ phase: 'after', analysisStatus: 'failed', hasAiSummary: true, dayHasAfter: false, narrationStatus: 'done' }),
    'failed',
  );
});

/* ---------- 4. narration image cap + graceful frame analysis ---------- */

test('narration never sends more than the Anthropic image limit', () => {
  const frames = Array.from({ length: 131 }, (_, i) => ({ atSeconds: i }));
  const capped = capNarrationFrames(frames);
  assert.equal(capped.length, MAX_NARRATION_FRAMES);
  assert.ok(capped.length <= 100);
  assert.equal(capped[0].atSeconds, 0);
  assert.equal(capped[capped.length - 1].atSeconds, 130);
  assert.equal(capNarrationFrames(frames.slice(0, 10)).length, 10);
});

function fakeSupabase(frames: Array<{ id: string; storage_path: string }>) {
  const inserts: Array<{ table: string; row: unknown }> = [];
  const builder = (table: string): any => {
    const result = () => ({
      data: table === 'verification_frames' ? frames.map((f, i) => ({ ...f, scene_id: null, timestamp_seconds: i })) : null,
      error: null,
    });
    const b: any = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') return (res: (v: unknown) => void) => res(result());
          if (prop === 'insert') return (row: unknown) => {
            inserts.push({ table, row });
            return b;
          };
          if (prop === 'maybeSingle' || prop === 'single') return () => Promise.resolve({ data: null, error: null });
          return () => b;
        },
      },
    );
    return b;
  };
  return { client: { from: builder, rpc: () => Promise.resolve({ data: null, error: null }) }, inserts };
}

function okResult(parsed: FrameObservationParsed, provider = 'google'): AnalysisResult<FrameObservationParsed> {
  return {
    parsed,
    raw: '{}',
    provider,
    modelName: 'gemini-3.1-pro-preview',
    modelVersion: null,
    promptVersion: 'v1',
    usage: { inputTokens: 1, outputTokens: 1, latencyMs: 1, providerRequestId: null, estimatedCostUsd: 0 },
    cached: false,
  };
}

function ctxFor(client: unknown) {
  return {
    supabase: client,
    orgId: 'org',
    jobId: 'job',
    partyId: null,
    videoId: 'vid',
    processingJobId: 'pj',
    attributedUserId: null,
  } as any;
}

test('a failing escalation keeps the primary reading instead of failing the video', async () => {
  const { client, inserts } = fakeSupabase([{ id: 'f1', storage_path: 'p1' }]);
  const analyzer: VisionAnalyzer = {
    analyzeFrame: async () => okResult(frameObservationSchema.parse({ ...OBS, confidence: 0.1 })),
    compareFrames: async () => {
      throw new Error('unused');
    },
    analyzeFrameSequence: async () => {
      throw new Error('unused');
    },
    escalateAnalysis: async () => {
      throw new Error('Gemini vision error 404: models/claude-haiku-4-5 is not found');
    },
  };
  const handler = createAnalyzeFramesHandler({ analyzer, loadFrameBase64: async () => 'aGk=' });
  const { output } = await handler(ctxFor(client));
  assert.equal(output.analyzed, 1);
  assert.equal(output.escalated, 0);
  assert.equal(output.escalationFailures, 1);
  assert.ok(inserts.some((i) => i.table === 'frame_observations'));
});

test('one unreadable frame is skipped; the video still analyzes', async () => {
  const { client } = fakeSupabase([
    { id: 'f1', storage_path: 'p1' },
    { id: 'f2', storage_path: 'p2' },
  ]);
  let n = 0;
  const analyzer: VisionAnalyzer = {
    analyzeFrame: async () => {
      n += 1;
      if (n === 1) throw new Error('malformed reply');
      return okResult(frameObservationSchema.parse({ ...OBS, confidence: 0.9 }));
    },
    compareFrames: async () => {
      throw new Error('unused');
    },
    analyzeFrameSequence: async () => {
      throw new Error('unused');
    },
    escalateAnalysis: async () => {
      throw new Error('unused');
    },
  };
  const handler = createAnalyzeFramesHandler({ analyzer, loadFrameBase64: async () => 'aGk=' });
  const { output } = await handler(ctxFor(client));
  assert.equal(output.analyzed, 1);
  assert.equal(output.failedFrames, 1);
});

test('when every frame fails, the step still fails with the real reason', async () => {
  const { client } = fakeSupabase([{ id: 'f1', storage_path: 'p1' }]);
  const analyzer: VisionAnalyzer = {
    analyzeFrame: async () => {
      throw new Error('provider down');
    },
    compareFrames: async () => {
      throw new Error('unused');
    },
    analyzeFrameSequence: async () => {
      throw new Error('unused');
    },
    escalateAnalysis: async () => {
      throw new Error('unused');
    },
  };
  const handler = createAnalyzeFramesHandler({ analyzer, loadFrameBase64: async () => 'aGk=' });
  await assert.rejects(handler(ctxFor(client)), /provider down/);
});
