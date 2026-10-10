/** Pure metrics for the long-recording eval (coverage, accuracy, missed work, cost). */

import type { TimelineEntry } from '../../src/longform/timeline.js';
import { timelineCoverage } from '../../src/longform/timeline.js';

export type MinuteLabel = { minute: number; activity: string; work: boolean; note?: string };

const GROUP: Record<string, 'work' | 'dead' | 'other'> = {
  site_work: 'work', walkthrough: 'work', talking: 'work',
  driving: 'dead', break: 'dead', pocket_or_dark: 'dead', idle: 'dead',
  screen_or_media: 'other', other: 'other',
};
export const activityGroup = (a: string) => GROUP[a] ?? 'other';

function entryGroup(e: TimelineEntry): 'work' | 'dead' | 'other' {
  if (e.dead) return 'dead';
  if (e.speech && activityGroup(e.activity) !== 'work') return 'work';
  return activityGroup(e.activity);
}

export type VariantScore = {
  minutes: number;
  coveragePct: number;
  gaps: number[];
  labelled: number;
  accuracyPct: number | null;
  missedWorkMinutes: number | null;
  agreementWithReferencePct: number | null;
  costUsd: number;
  costPerMinuteUsd: number;
  costPerHourUsd: number;
  pass: 'PASS' | 'FAIL' | 'UNVERIFIED';
  reasons: string[];
};

export const PASS_BAR = { coveragePct: 100, accuracyPct: 98, missedWorkMinutes: 0 };

export function scoreVariant(input: {
  entries: TimelineEntry[];
  durationSeconds: number;
  costUsd: number;
  labels?: MinuteLabel[] | null;
  reference?: TimelineEntry[] | null;
}): VariantScore {
  const cov = timelineCoverage(input.entries, input.durationSeconds);
  const byMinute = new Map(input.entries.map((e) => [Math.round(e.startSeconds / 60), e]));
  let labelled = 0;
  let correct = 0;
  let missed = 0;
  for (const l of input.labels ?? []) {
    const e = byMinute.get(l.minute);
    if (!e) continue;
    labelled += 1;
    const g = entryGroup(e);
    if (g === activityGroup(l.activity) || (l.work && g === 'work')) correct += 1;
    if (l.work && g === 'dead') missed += 1;
  }
  let agree: number | null = null;
  if (input.reference?.length) {
    const ref = new Map(input.reference.map((e) => [Math.round(e.startSeconds / 60), entryGroup(e)]));
    let n = 0;
    let same = 0;
    for (const e of input.entries) {
      const r = ref.get(Math.round(e.startSeconds / 60));
      if (!r) continue;
      n += 1;
      if (r === entryGroup(e)) same += 1;
    }
    agree = n ? (same / n) * 100 : null;
  }
  const minutes = input.durationSeconds / 60;
  const accuracy = labelled ? (correct / labelled) * 100 : null;
  const reasons: string[] = [];
  if (cov.pct < PASS_BAR.coveragePct) reasons.push(`coverage ${cov.pct.toFixed(1)}% < 100% (gap minutes: ${cov.gaps.slice(0, 10).join(', ')})`);
  if (accuracy != null && accuracy < PASS_BAR.accuracyPct) reasons.push(`accuracy ${accuracy.toFixed(1)}% < ${PASS_BAR.accuracyPct}%`);
  if (labelled && missed > PASS_BAR.missedWorkMinutes) reasons.push(`${missed} work minute(s) labelled dead`);
  if (!labelled) reasons.push('no human labels: accuracy unverified');
  const pass = reasons.some((r) => !r.startsWith('no human labels')) ? 'FAIL' : labelled ? 'PASS' : 'UNVERIFIED';
  return {
    minutes: cov.minutes,
    coveragePct: cov.pct,
    gaps: cov.gaps,
    labelled,
    accuracyPct: accuracy,
    missedWorkMinutes: labelled ? missed : null,
    agreementWithReferencePct: agree,
    costUsd: input.costUsd,
    costPerMinuteUsd: minutes ? input.costUsd / minutes : 0,
    costPerHourUsd: minutes ? (input.costUsd / minutes) * 60 : 0,
    pass,
    reasons,
  };
}
