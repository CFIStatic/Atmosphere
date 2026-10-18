import test from 'node:test';
import assert from 'node:assert/strict';
import { currentAiUsageScope, runWithAiUsageScope } from '../src/metering/aiUsageContext.js';
import { withVideoUsageScope } from '../src/metering/backgroundUsage.js';
import {
  completeAskText,
  resetBackgroundCallSlots,
  takeBackgroundCallSlot,
  videoMaxModelCallsPerClip,
} from '../src/lib/askModel.js';

const scope = (proofId: string | null, meterFeature: string | null = 'video_analysis', durationSeconds?: number) => ({
  client: {} as never,
  orgId: 'org',
  requestId: 'r',
  meterFeature,
  proofId,
  durationSeconds,
});

function clearCapEnv() {
  delete process.env.VIDEO_MAX_MODEL_CALLS_PER_CLIP;
  delete process.env.VIDEO_CALLS_BASE;
  delete process.env.VIDEO_CALLS_PER_HOUR;
}

test('per-clip cap stops background calls after the limit, per clip, and frees up after 6h', async () => {
  process.env.VIDEO_MAX_MODEL_CALLS_PER_CLIP = '3';
  resetBackgroundCallSlots();
  const t0 = Date.now();
  await runWithAiUsageScope(scope('a'), async () => {
    assert.deepEqual([1, 2, 3, 4].map(() => takeBackgroundCallSlot(t0)), [true, true, true, false]);
  });
  await runWithAiUsageScope(scope('b'), async () => assert.equal(takeBackgroundCallSlot(t0), true));
  await runWithAiUsageScope(scope('a'), async () => {
    assert.equal(takeBackgroundCallSlot(t0 + 5 * 3600_000), false);
    assert.equal(takeBackgroundCallSlot(t0 + 6 * 3600_000 + 1), true);
  });
  clearCapEnv();
});

test('cap never applies to Ask turns, unscoped calls, or when set to 0', async () => {
  process.env.VIDEO_MAX_MODEL_CALLS_PER_CLIP = '1';
  resetBackgroundCallSlots();
  // Ask turn: scope without meterFeature.
  await runWithAiUsageScope(scope('a', null), async () => {
    assert.equal(takeBackgroundCallSlot(), true);
    assert.equal(takeBackgroundCallSlot(), true);
  });
  // Metered scope with no clip.
  await runWithAiUsageScope(scope(null), async () => {
    assert.equal(takeBackgroundCallSlot(), true);
    assert.equal(takeBackgroundCallSlot(), true);
  });
  assert.equal(takeBackgroundCallSlot(), true);
  process.env.VIDEO_MAX_MODEL_CALLS_PER_CLIP = '0';
  await runWithAiUsageScope(scope('c'), async () => {
    assert.equal(takeBackgroundCallSlot(), true);
    assert.equal(takeBackgroundCallSlot(), true);
  });
  clearCapEnv();
});

test('default cap scales with footage: 30 + 25 per hour', () => {
  clearCapEnv();
  assert.equal(videoMaxModelCallsPerClip(null), 30);
  assert.equal(videoMaxModelCallsPerClip(60), 31);
  assert.equal(videoMaxModelCallsPerClip(4 * 3600), 130);
  assert.equal(videoMaxModelCallsPerClip(8 * 3600), 230);
  process.env.VIDEO_CALLS_BASE = '10';
  process.env.VIDEO_CALLS_PER_HOUR = 'nonsense';
  assert.equal(videoMaxModelCallsPerClip(3600), 35);
  process.env.VIDEO_MAX_MODEL_CALLS_PER_CLIP = '0';
  assert.equal(videoMaxModelCallsPerClip(8 * 3600), 0);
  clearCapEnv();
});

test('long clip gets the larger cap from the scope duration', async () => {
  clearCapEnv();
  resetBackgroundCallSlots();
  await runWithAiUsageScope(scope('long', 'video_analysis', 4 * 3600), async () => {
    const ok = Array.from({ length: 131 }, () => takeBackgroundCallSlot());
    assert.equal(ok.filter(Boolean).length, 130);
  });
});

test('a capped clip gets null from completeAskText without calling a provider', async () => {
  process.env.VIDEO_MAX_MODEL_CALLS_PER_CLIP = '1';
  resetBackgroundCallSlots();
  await runWithAiUsageScope(scope('capped'), async () => {
    assert.equal(takeBackgroundCallSlot(), true);
    const result = await completeAskText({ system: 's', user: 'u', mode: 'analysis' });
    assert.equal(result, null);
  });
  clearCapEnv();
});

test('withVideoUsageScope carries the clip id and its length into the scope', async () => {
  const fakeClient = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data:
              table === 'job_proofs'
                ? { org_id: 'org-1', job_id: 'job-1', party_id: 'party-1', duration_seconds: '5400.00' }
                : null,
          }),
        }),
      }),
    }),
  } as never;
  const seen = await withVideoUsageScope(fakeClient, { proofId: 'proof-1', userId: 'user-1' }, async () => {
    const s = currentAiUsageScope();
    return { proofId: s?.proofId, durationSeconds: s?.durationSeconds, orgId: s?.orgId, feature: s?.meterFeature };
  });
  assert.deepEqual(seen, { proofId: 'proof-1', durationSeconds: 5400, orgId: 'org-1', feature: 'video_analysis' });
  // Org given by the caller: still looks up the length for the cap.
  const withOrg = await withVideoUsageScope(
    fakeClient,
    { proofId: 'proof-2', orgId: 'org-9', userId: 'user-1' },
    async () => currentAiUsageScope()?.durationSeconds,
  );
  assert.equal(withOrg, 5400);
});
