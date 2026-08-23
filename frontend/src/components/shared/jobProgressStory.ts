import type { JobRisk, JobScopeItem, ProofDay, ScopeState } from '../../lib/api';
import { formatClipClocks } from '../../lib/videoDuration';

export type StoryTone = 'success' | 'caution' | 'danger' | 'neutral';
export type StoryKind = 'day' | 'scope' | 'attention';

export type StoryItem = {
  id: string;
  title: string;
  detail: string;
  badge: string;
  tone: StoryTone;
  kind: StoryKind;
  /** Clip lengths for a filmed day, e.g. `1:08 · 1:34`. */
  clock?: string | null;
};

export type JobProgressStory = {
  happening: StoryItem[];
  happened: StoryItem[];
  next: StoryItem[];
  /** Scope lines that finished (or verified days when there is no scope). */
  doneCount: number;
  /** Happened + happening + next work items (exclusions omitted). */
  trackedCount: number;
  exclusionCount: number;
};

type ScopeLike = Pick<JobScopeItem, 'id' | 'state' | 'title' | 'detail' | 'reason'>;
type RiskLike = Pick<JobRisk, 'title' | 'action' | 'level'> & { key?: string };
type DayLike = Pick<
  ProofDay,
  | 'partyId'
  | 'company'
  | 'workDate'
  | 'hasBefore'
  | 'hasAfter'
  | 'contradicted'
  | 'accepted'
  | 'rejected'
  | 'payable'
  | 'summary'
  | 'aiSummary'
> & {
  aiFindings?: ProofDay['aiFindings'];
  proofClips?: ProofDay['proofClips'];
};

const SKIP_STATES: ScopeState[] = ['excluded', 'declined'];

export function formatWorkDay(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function dayIsOnSite(day: DayLike): boolean {
  return day.hasBefore && !day.hasAfter;
}

export function dayHasFinished(day: DayLike): boolean {
  return day.hasAfter || day.accepted || day.payable || day.rejected || day.contradicted;
}

export function dayStatus(day: DayLike): { label: string; tone: StoryTone } {
  if (day.contradicted) return { label: 'Issue found', tone: 'danger' };
  if (day.rejected) return { label: 'Rejected', tone: 'danger' };
  if (day.accepted || day.payable) return { label: 'Verified', tone: 'success' };
  if (day.aiSummary) return { label: 'Work described', tone: 'success' };
  if (dayIsOnSite(day)) return { label: 'On site now', tone: 'caution' };
  if (day.hasAfter) return { label: 'Being reviewed', tone: 'neutral' };
  return { label: 'Logged', tone: 'neutral' };
}

function norm(title: string): string {
  return title.trim().toLowerCase();
}

function latestVerdicts(days: DayLike[]): Map<string, { verdict: string; because: string }> {
  const map = new Map<string, { verdict: string; because: string }>();
  const sorted = [...days].sort((a, b) => a.workDate.localeCompare(b.workDate));
  for (const day of sorted) {
    for (const v of day.aiFindings?.scopeVerdicts ?? []) {
      map.set(norm(v.title), { verdict: v.verdict, because: v.because });
    }
    for (const title of day.aiFindings?.scopeTouched ?? []) {
      const key = norm(title);
      if (!map.has(key)) {
        map.set(key, { verdict: 'in_progress', because: 'Seen in field footage.' });
      }
    }
  }
  return map;
}

function scopeBadge(state: ScopeState, verdict: string | undefined): { label: string; tone: StoryTone } {
  if (verdict === 'appears_complete') return { label: 'Done', tone: 'success' };
  if (verdict === 'in_progress') return { label: 'In progress', tone: 'caution' };
  if (state === 'proposed') return { label: 'Waiting on a decision', tone: 'caution' };
  if (state === 'approved') return { label: 'Approved — not started', tone: 'neutral' };
  if (state === 'included') return { label: 'Queued', tone: 'neutral' };
  return { label: 'Upcoming', tone: 'neutral' };
}

function dayToItem(day: DayLike): StoryItem {
  const badge = dayStatus(day);
  const summary = day.aiSummary ?? day.summary;
  return {
    id: `day:${day.partyId}|${day.workDate}`,
    title: `${formatWorkDay(day.workDate)} · ${day.company}`,
    detail: summary,
    badge: badge.label,
    tone: badge.tone,
    kind: 'day',
    clock: formatClipClocks(day.proofClips),
  };
}

function scopeToItem(item: ScopeLike, verdict: string | undefined, because: string | undefined): StoryItem {
  const badge = scopeBadge(item.state, verdict);
  const detail = because || item.detail || item.reason || '';
  return {
    id: `scope:${item.id}`,
    title: item.title,
    detail,
    badge: badge.label,
    tone: badge.tone,
    kind: 'scope',
  };
}

function bucketForScope(state: ScopeState, verdict: string | undefined): 'happening' | 'happened' | 'next' | 'skip' {
  if (SKIP_STATES.includes(state)) return 'skip';
  if (verdict === 'appears_complete') return 'happened';
  if (verdict === 'in_progress') return 'happening';
  return 'next';
}

/**
 * Split a job into happening now / already done / still ahead.
 * Exclusions stay out of the timeline — they are constraints, not work.
 */
export function buildJobProgressStory(input: {
  scope: ScopeLike[];
  days: DayLike[];
  risks: RiskLike[];
}): JobProgressStory {
  const happening: StoryItem[] = [];
  const happened: StoryItem[] = [];
  const next: StoryItem[] = [];
  const verdicts = latestVerdicts(input.days);
  const knownTitles = new Set(input.scope.map((s) => norm(s.title)));

  for (const risk of input.risks) {
    if (risk.level !== 'blocker' && risk.level !== 'warn') continue;
    happening.push({
      id: `attention:${risk.key ?? risk.title}`,
      title: risk.title,
      detail: risk.action,
      badge: risk.level === 'blocker' ? 'Needs a decision' : 'Watch',
      tone: risk.level === 'blocker' ? 'danger' : 'caution',
      kind: 'attention',
    });
  }

  const onSiteDays = input.days.filter(dayIsOnSite);
  const finishedDays = input.days.filter((d) => dayHasFinished(d) && !dayIsOnSite(d));

  happening.push(...onSiteDays.map(dayToItem));
  happened.push(
    ...[...finishedDays].sort((a, b) => b.workDate.localeCompare(a.workDate)).map(dayToItem),
  );

  let exclusionCount = 0;
  for (const item of input.scope) {
    const v = verdicts.get(norm(item.title));
    const bucket = bucketForScope(item.state, v?.verdict);
    if (bucket === 'skip') {
      exclusionCount += 1;
      continue;
    }
    const row = scopeToItem(item, v?.verdict, v?.because);
    if (bucket === 'happened') happened.push(row);
    else if (bucket === 'happening') happening.push(row);
    else next.push(row);
  }

  // Guest shares often have proof days but no scope rows — still surface the work list.
  if (input.scope.length === 0) {
    for (const [titleKey, v] of verdicts) {
      if (knownTitles.has(titleKey)) continue;
      const title = [...(input.days.flatMap((d) => [
        ...(d.aiFindings?.scopeVerdicts ?? []).map((x) => x.title),
        ...(d.aiFindings?.scopeTouched ?? []),
      ]))].find((t) => norm(t) === titleKey);
      if (!title) continue;
      const synthetic: ScopeLike = {
        id: `from-proof:${titleKey}`,
        state: 'included',
        title,
        detail: null,
        reason: null,
      };
      const bucket = bucketForScope('included', v.verdict);
      const row = scopeToItem(synthetic, v.verdict, v.because);
      if (bucket === 'happened') happened.push(row);
      else if (bucket === 'happening') happening.push(row);
      else next.push(row);
    }
  }

  const scopeHappened = happened.filter((i) => i.kind === 'scope').length;
  const scopeHappening = happening.filter((i) => i.kind === 'scope').length;
  const scopeNext = next.filter((i) => i.kind === 'scope').length;
  const trackedFromScope = scopeHappened + scopeHappening + scopeNext;

  const doneCount =
    trackedFromScope > 0 ? scopeHappened : finishedDays.filter((d) => d.accepted || d.payable).length;
  const trackedCount =
    trackedFromScope > 0
      ? trackedFromScope
      : onSiteDays.length + finishedDays.length;

  return {
    happening,
    happened,
    next,
    doneCount,
    trackedCount,
    exclusionCount,
  };
}
