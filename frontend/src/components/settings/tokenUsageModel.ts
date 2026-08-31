import type { TokenFeature, TokenTotals, TokenUsageDay } from '../../lib/api';
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
