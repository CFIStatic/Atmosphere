import test from 'node:test';
import assert from 'node:assert/strict';
import { runWithAiUsageScope } from '../src/metering/aiUsageContext.js';
import { resetBackgroundCallSlots, takeBackgroundCallSlot, videoStageAnthropicModel } from '../src/lib/askModel.js';
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
