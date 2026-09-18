import type { TokenFeature, TokenTotals, TokenUsageDay, TokenUsageRange } from '../../lib/api';
import { TOKEN_FEATURES } from '../../lib/api';

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
    input.range === '90d' ? 'Last 90 days' : input.range === '30d' ? 'Last 30 days' : 'This billing period';
  const who = input.orgName?.trim() || 'this organization';
  return `${period}, ${formatUtcDateLabel(input.periodStart)} to ${formatUtcDateLabel(input.periodEnd)} UTC · USD · ${who}`;
}
