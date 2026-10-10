import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreVariant } from '../scripts/eval/metrics.js';
import { SpendGuard } from '../scripts/eval/spendGuard.js';
import { buildMinuteTimeline } from '../src/longform/timeline.js';
import type { CaptionActivity } from '../src/longform/captions.js';

const cap = (t: number, activity: CaptionActivity) => ({ atSeconds: t, caption: activity, activity, room: null, confidence: 0.9, model: 'm', status: 'ok' as const });

test('spend guard refuses a call that would cross the cap and caps the budget at $300', () => {
  assert.throws(() => new SpendGuard(301));
  const g = new SpendGuard(1);
  g.reserve(0.6);
  g.record(0.6);
  assert.throws(() => g.reserve(0.5), (e: { spendCap?: boolean }) => e.spendCap === true);
});

test('score: coverage, accuracy vs labels, missed work, cost per hour', () => {
  const entries = buildMinuteTimeline({
    durationSeconds: 180,
    captions: [cap(0, 'site_work'), cap(60, 'driving'), cap(120, 'idle')],
    transcript: [],
  });
  const s = scoreVariant({
    entries,
    durationSeconds: 180,
    costUsd: 0.03,
    labels: [
      { minute: 0, activity: 'site_work', work: true },
      { minute: 1, activity: 'driving', work: false },
      { minute: 2, activity: 'site_work', work: true },
    ],
  });
  assert.equal(s.coveragePct, 100);
  assert.equal(Math.round(s.accuracyPct!), 67);
  assert.equal(s.missedWorkMinutes, 1);
  assert.equal(s.pass, 'FAIL');
  assert.ok(Math.abs(s.costPerHourUsd - 0.6) < 1e-9);
  const unlabelled = scoreVariant({ entries, durationSeconds: 180, costUsd: 0.03, reference: entries });
  assert.equal(unlabelled.pass, 'UNVERIFIED');
  assert.equal(unlabelled.agreementWithReferencePct, 100);
});
