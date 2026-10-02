import type {
  TokenDayActor,
  TokenFeature,
  TokenTotals,
  TokenUsageDay,
  TokenUsageRange,
  TokenUsageRecent,
} from '../../lib/api';
import { TOKEN_FEATURE_LABELS, TOKEN_FEATURES } from '../../lib/api';

export const TOKEN_FEATURE_COLOR: Record<TokenFeature, string> = {
  video_analysis: 'rgb(var(--brand-600))',
  chat: 'rgb(var(--success-600))',
  ask: 'rgb(var(--caution-600))',
  other: 'rgb(var(--ink-400))',
};

export const TOKEN_FEATURE_TRACK: Record<TokenFeature, string> = {
  video_analysis: 'bg-brand-600',
  chat: 'bg-success-600',
  ask: 'bg-caution-600',
  other: 'bg-ink-400',
};

export const emptyTokenTotals = (): TokenTotals => ({
  events: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheTokens: 0,
  totalTokens: 0,
  priceNanos: 0,
});

export function featureTokens(day: TokenUsageDay, feature: TokenFeature): number {
  return day.byFeature?.[feature]?.totalTokens ?? 0;
}

export function peakDayTokens(days: TokenUsageDay[]): number {
  return Math.max(1, ...days.map((day) => day.totalTokens));
}

export function sharePct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.min(100, Math.max(0, (part / whole) * 100));
}

export function compactDayLabel(isoDay: string): string {
  const date = new Date(`${isoDay}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return isoDay;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function activeFeatures(days: TokenUsageDay[]): TokenFeature[] {
  return TOKEN_FEATURES.filter((feature) => days.some((day) => featureTokens(day, feature) > 0));
}

/** Display analysis minutes from the API (already rounded) or format seconds. */
export function formatAnalysisMinutes(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return '—';
  if (minutes === 0) return '0';
  return Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1);
}

export function formatUtcDateLabel(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Period + unit + whose spend, for the Settings token-spend figure. */
export function tokenSpendCaption(input: {
  range: TokenUsageRange;
  periodStart: string;
  periodEnd: string;
  orgName?: string | null;
}): string {
  const period =
    input.range === '90d'
      ? 'Last 90 days'
      : input.range === '30d'
        ? 'Last 30 days'
        : 'This billing period';
  const who = input.orgName?.trim() || 'this organization';
  return `${period}, ${formatUtcDateLabel(input.periodStart)} to ${formatUtcDateLabel(input.periodEnd)} UTC · USD · ${who}`;
}

export interface DailyUsageRow {
  /** UTC day, `YYYY-MM-DD`. */
  day: string;
  label: string;
  calls: number;
  totalTokens: number;
  priceNanos: number;
  who: string;
  surfaces: string;
  /** Compact who and surface line, most-used first. */
  breakdown: string;
}

function featureActivity(day: TokenUsageDay, feature: TokenFeature): TokenTotals | undefined {
  return day.byFeature?.[feature];
}

function featureWasUsed(totals: TokenTotals | undefined): boolean {
  if (!totals) return false;
  return totals.events > 0 || totals.totalTokens > 0 || totals.priceNanos > 0;
}

/** Surfaces with calls or cost this day, most-used first. */
export function dailySurfaceLabel(day: TokenUsageDay): string {
  const used = TOKEN_FEATURES.filter((feature) =>
    featureWasUsed(featureActivity(day, feature)),
  ).sort((a, b) => {
    const left = featureActivity(day, a);
    const right = featureActivity(day, b);
    const events = (right?.events ?? 0) - (left?.events ?? 0);
    if (events !== 0) return events;
    const price = (right?.priceNanos ?? 0) - (left?.priceNanos ?? 0);
    if (price !== 0) return price;
    const tokens = (right?.totalTokens ?? 0) - (left?.totalTokens ?? 0);
    if (tokens !== 0) return tokens;
    return TOKEN_FEATURES.indexOf(a) - TOKEN_FEATURES.indexOf(b);
  });
  if (used.length === 0) return '—';
  return used.map((feature) => TOKEN_FEATURE_LABELS[feature]).join(', ');
}

/** Up to three names, most calls first. Further people collapse to `+N`. */
export function dailyActorLabel(actors: TokenDayActor[]): string {
  const ranked = actors
    .filter((actor) => actor.name.trim() && actor.events > 0)
    .sort((a, b) => b.events - a.events || a.name.localeCompare(b.name));
  if (ranked.length === 0) return '—';
  if (ranked.length <= 3) return ranked.map((actor) => actor.name).join(', ');
  const shown = ranked
    .slice(0, 2)
    .map((actor) => actor.name)
    .join(', ');
  return `${shown} +${ranked.length - 2}`;
}

function actorsFromRecent(day: string, recent: TokenUsageRecent[]): TokenDayActor[] {
  const counts = new Map<string, TokenDayActor>();
  for (const row of recent) {
    if (row.createdAt.slice(0, 10) !== day) continue;
    const name = row.userName?.trim() || 'System';
    const key = row.userId ?? `name:${name}`;
    const existing = counts.get(key);
    if (existing) existing.events += 1;
    else counts.set(key, { userId: row.userId, name, events: 1 });
  }
  return [...counts.values()];
}

function whoForDay(day: TokenUsageDay, recent: TokenUsageRecent[]): string {
  if (day.actors && day.actors.length > 0) return dailyActorLabel(day.actors);
  const fromRecent = actorsFromRecent(day.day, recent);
  const covered = fromRecent.reduce((sum, actor) => sum + actor.events, 0);
  if (covered > 0 && covered === day.events) return dailyActorLabel(fromRecent);
  return '—';
}

function breakdownLine(who: string, surfaces: string): string {
  const parts = [who, surfaces].filter((part) => part && part !== '—');
  return parts.join(' · ') || '—';
}

function dayHasUsage(day: TokenUsageDay): boolean {
  return day.events > 0 || day.totalTokens > 0 || day.priceNanos > 0;
}

/**
 * One row per UTC day that had metered calls. Totals are the day's summed
 * nanodollars and tokens — not a re-round of each call. Newest day first.
 */
export function dailyUsageRows(
  days: TokenUsageDay[],
  recent: TokenUsageRecent[] = [],
): DailyUsageRow[] {
  return days
    .filter(dayHasUsage)
    .slice()
    .sort((a, b) => b.day.localeCompare(a.day))
    .map((day) => {
      const who = whoForDay(day, recent);
      const surfaces = dailySurfaceLabel(day);
      return {
        day: day.day,
        label: formatUtcDateLabel(`${day.day}T00:00:00.000Z`),
        calls: day.events,
        totalTokens: day.totalTokens,
        priceNanos: day.priceNanos,
        who,
        surfaces,
        breakdown: breakdownLine(who, surfaces),
      };
    });
}
