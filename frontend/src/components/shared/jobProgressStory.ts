import type { JobRisk, JobScopeItem, ProofDay, ScopeState } from '../../lib/api';

export type StoryTone = 'success' | 'caution' | 'danger' | 'neutral';
export type StoryKind = 'day' | 'scope' | 'attention';

export type StoryItem = {
  id: string;
  title: string;
  detail: string;
  badge: string;
  tone: StoryTone;
  kind: StoryKind;
};

export type JobProgressStory = {
  /** Blockers / warnings that need a homeowner or office decision. */
  attention: StoryItem[];
  happening: StoryItem[];
  happened: StoryItem[];
  next: StoryItem[];
  /** Scope lines that finished (or verified days when there is no scope). */
  doneCount: number;
  /** Happened + happening + next work items (exclusions omitted). */
  trackedCount: number;
  exclusionCount: number;
};

export type UpToSpeedSummary = {
  /** One or two plain sentences for a homeowner. */
  text: string;
  tone: StoryTone;
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

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * One or two plain sentences so a homeowner is brought up to speed.
 * Leads with attention when something needs a decision.
 */
export function buildUpToSpeedSummary(story: JobProgressStory): UpToSpeedSummary {
  const sentences: string[] = [];
  let tone: StoryTone = 'neutral';

  const dangerAttention = story.attention.filter((i) => i.tone === 'danger');
  if (dangerAttention.length > 0) {
    const first = dangerAttention[0].title;
    sentences.push(
      dangerAttention.length === 1
        ? `Needs your attention: ${first}.`
        : `Needs your attention: ${first} (+${dangerAttention.length - 1} more).`,
    );
    tone = 'danger';
  } else if (story.attention.length > 0) {
    const first = story.attention[0].title;
    sentences.push(
      story.attention.length === 1
        ? `Worth a look: ${first}.`
        : `Worth a look: ${first} (+${story.attention.length - 1} more).`,
    );
    tone = 'caution';
  }

  const progressBits: string[] = [];
  if (story.trackedCount > 0) {
    progressBits.push(
      `Crews finished ${story.doneCount} of ${story.trackedCount} work ${plural(story.trackedCount, 'item', 'items')}`,
    );
    if (tone === 'neutral' && story.doneCount > 0) tone = 'success';
  } else if (story.happened.length === 0 && story.happening.length === 0) {
    progressBits.push('Nothing has been filmed yet');
  } else if (story.happened.length > 0) {
    progressBits.push(
      `${story.happened.length} field ${plural(story.happened.length, 'update is', 'updates are')} on record`,
    );
    if (tone === 'neutral') tone = 'success';
  }

  const onSiteNow = story.happening.filter((i) => i.kind === 'day');
  const inProgressScope = story.happening.filter((i) => i.kind === 'scope');
  if (onSiteNow.length > 0) {
    progressBits.push(
      onSiteNow.length === 1
        ? `${onSiteNow[0].title} is on site now`
        : `${onSiteNow.length} crews are on site right now`,
    );
    if (tone === 'neutral' || tone === 'success') tone = 'caution';
  } else if (inProgressScope.length > 0) {
    progressBits.push(
      inProgressScope.length === 1
        ? `In progress: ${inProgressScope[0].title}`
        : `${inProgressScope.length} work items are in progress`,
    );
    if (tone === 'neutral' || tone === 'success') tone = 'caution';
  } else if (story.trackedCount > 0 || story.happened.length > 0) {
    progressBits.push('Nothing is on site today');
    if (story.next.length > 0) {
      const nextTitle = story.next[0].title;
      const more = story.next.length > 1 ? ` (+${story.next.length - 1} more)` : '';
      progressBits.push(`Next up: ${nextTitle}${more}`);
    }
  } else if (story.next.length > 0) {
    const nextTitle = story.next[0].title;
    const more = story.next.length > 1 ? ` (+${story.next.length - 1} more)` : '';
    progressBits.push(`Next up: ${nextTitle}${more}`);
  }

  if (progressBits.length > 0) {
    // Fold progress + now/next into one sentence so the banner stays to ~2 lines.
    const joined =
      progressBits.length === 1
        ? `${progressBits[0]}.`
        : `${progressBits[0]}. ${progressBits.slice(1).join('. ')}.`.replace(/\.\./g, '.');
    sentences.push(joined);
  }

  const text = sentences.slice(0, 2).join(' ').trim();
  return { text: text || 'Checking the latest job updates.', tone };
}

/**
 * Split a job into attention / happening now / already done / still ahead.
 * Exclusions stay out of the timeline — they are constraints, not work.
 */
export function buildJobProgressStory(input: {
  scope: ScopeLike[];
  days: DayLike[];
  risks: RiskLike[];
}): JobProgressStory {
  const attention: StoryItem[] = [];
  const happening: StoryItem[] = [];
  const happened: StoryItem[] = [];
  const next: StoryItem[] = [];
  const verdicts = latestVerdicts(input.days);
  const knownTitles = new Set(input.scope.map((s) => norm(s.title)));

  for (const risk of input.risks) {
    if (risk.level !== 'blocker' && risk.level !== 'warn') continue;
    attention.push({
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
      const title = [
        ...input.days.flatMap((d) => [
          ...(d.aiFindings?.scopeVerdicts ?? []).map((x) => x.title),
          ...(d.aiFindings?.scopeTouched ?? []),
        ]),
      ].find((t) => norm(t) === titleKey);
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
    trackedFromScope > 0 ? trackedFromScope : onSiteDays.length + finishedDays.length;

  return {
    attention,
    happening,
    happened,
    next,
    doneCount,
    trackedCount,
    exclusionCount,
  };
}
