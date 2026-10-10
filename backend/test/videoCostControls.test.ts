import test from 'node:test';
import assert from 'node:assert/strict';
import { runWithAiUsageScope } from '../src/metering/aiUsageContext.js';
import { resetBackgroundCallSlots, takeBackgroundCallSlot, videoStageAnthropicModel } from '../src/lib/askModel.js';
import { fusionTranscriptChunks, FUSION_CHUNK_CHARS } from '../src/audio/evidenceFusion.js';
import { videoMaxModelCallsPerClip } from '../src/lib/askModel.js';
import { capNarrationFrames, narrationMaxFrames } from '../src/shared/liveNarrator.js';

const scope = (proofId: string | null, meterFeature: string | null = 'video_analysis') =>
  ({ client: {} as never, orgId: 'org', requestId: 'r', meterFeature, proofId });

test('per-clip cap stops background calls after the limit, per clip', async () => {
  process.env.VIDEO_MAX_MODEL_CALLS_PER_CLIP = '3';
  resetBackgroundCallSlots();
  await runWithAiUsageScope(scope('a'), async () => {
    assert.deepEqual([1, 2, 3, 4].map(() => takeBackgroundCallSlot()), [true, true, true, false]);
  });
  await runWithAiUsageScope(scope('b'), async () => assert.equal(takeBackgroundCallSlot(), true));
  // window expiry
  await runWithAiUsageScope(scope('a'), async () =>
    assert.equal(takeBackgroundCallSlot(Date.now() + 7 * 3600_000), true));
  delete process.env.VIDEO_MAX_MODEL_CALLS_PER_CLIP;
});

test('cap never applies to Ask turns or when disabled', async () => {
  process.env.VIDEO_MAX_MODEL_CALLS_PER_CLIP = '1';
  resetBackgroundCallSlots();
  await runWithAiUsageScope(scope('a', null), async () => {
    assert.equal(takeBackgroundCallSlot(), true);
    assert.equal(takeBackgroundCallSlot(), true);
  });
  assert.equal(takeBackgroundCallSlot(), true);
  process.env.VIDEO_MAX_MODEL_CALLS_PER_CLIP = '0';
  await runWithAiUsageScope(scope('c'), async () => {
    assert.equal(takeBackgroundCallSlot(), true);
    assert.equal(takeBackgroundCallSlot(), true);
  });
  delete process.env.VIDEO_MAX_MODEL_CALLS_PER_CLIP;
});

test('narration frame cap keeps first and last, evenly spaced', () => {
  const frames = Array.from({ length: 40 }, (_, i) => i);
  const kept = capNarrationFrames(frames, 16);
  assert.equal(kept.length, 16);
  assert.equal(kept[0], 0);
  assert.equal(kept[15], 39);
  assert.deepEqual(capNarrationFrames([1, 2], 16), [1, 2]);
  assert.equal(capNarrationFrames(frames, 0).length, 40);
  assert.equal(narrationMaxFrames(), 0);
});

test('stage model override is blank by default', () => {
  delete process.env.VIDEO_SUMMARY_MODEL;
  assert.equal(videoStageAnthropicModel('VIDEO_SUMMARY_MODEL'), undefined);
  process.env.VIDEO_SUMMARY_MODEL = 'claude-sonnet-5-5';
  assert.equal(videoStageAnthropicModel('VIDEO_SUMMARY_MODEL'), 'claude-sonnet-5-5');
  delete process.env.VIDEO_SUMMARY_MODEL;
});

test('call cap scales with footage: 30 + 25 per hour', () => {
  delete process.env.VIDEO_MAX_MODEL_CALLS_PER_CLIP;
  assert.equal(videoMaxModelCallsPerClip(60), 31);
  assert.equal(videoMaxModelCallsPerClip(null), 30);
  assert.equal(videoMaxModelCallsPerClip(4 * 3600), 130);
  assert.equal(videoMaxModelCallsPerClip(8 * 3600), 230);
  process.env.VIDEO_MAX_MODEL_CALLS_PER_CLIP = '0';
  assert.equal(videoMaxModelCallsPerClip(8 * 3600), 0);
  delete process.env.VIDEO_MAX_MODEL_CALLS_PER_CLIP;
});

test('long-clip cap uses the scope duration', async () => {
  delete process.env.VIDEO_MAX_MODEL_CALLS_PER_CLIP;
  resetBackgroundCallSlots();
  await runWithAiUsageScope({ ...scope('long'), durationSeconds: 4 * 3600 }, async () => {
    const ok = Array.from({ length: 131 }, () => takeBackgroundCallSlot());
    assert.equal(ok.filter(Boolean).length, 130);
  });
});

test('fusion reads the whole long transcript in chunks, short stays one pass', () => {
  const line = 'x'.repeat(99);
  const long = Array.from({ length: 3000 }, () => line).join('\n'); // ~300k chars, ~8h of talk
  const chunks = fusionTranscriptChunks(long);
  assert.ok(chunks.length >= 30);
  assert.ok(chunks.every((c) => c.length <= FUSION_CHUNK_CHARS));
  assert.equal(chunks.join('\n').length, long.length);
  assert.deepEqual(fusionTranscriptChunks('short'), ['short']);
  process.env.VIDEO_FUSION_CHUNKED = 'false';
  assert.equal(fusionTranscriptChunks(long).length, 1);
  delete process.env.VIDEO_FUSION_CHUNKED;
});
