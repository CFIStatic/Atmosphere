import type { TokenUsageAnalyticsPayload } from './types';

export const FEATURE_LABELS: Record<string, string> = {
  video_analysis: 'Video analysis',
  chat: 'Chat',
  web_search: 'Web search',
  other: 'Other',
};

const FEATURE_ORDER = ['video_analysis', 'chat', 'web_search', 'other'];

type FeatureRow = NonNullable<TokenUsageAnalyticsPayload['byFeature']>[number];

/**
 * Ask and Chat are one product surface: the ledger's `ask` rows are shown and
 * summed under "Chat". Display only; totals are unchanged.
 */
export function mergeAskIntoChat(rows: FeatureRow[] | undefined): FeatureRow[] {
  const merged = new Map<string, FeatureRow>();
  for (const row of rows ?? []) {
    const feature = row.feature === 'ask' ? 'chat' : row.feature;
    const prev = merged.get(feature);
    merged.set(feature, {
      feature,
      eventCount: (prev?.eventCount ?? 0) + row.eventCount,
      totalTokens: (prev?.totalTokens ?? 0) + row.totalTokens,
      priceNanos: (prev?.priceNanos ?? 0) + row.priceNanos,
    });
  }
  const rank = (feature: string) => {
    const i = FEATURE_ORDER.indexOf(feature);
    return i < 0 ? FEATURE_ORDER.length : i;
  };
  return [...merged.values()].sort((a, b) => rank(a.feature) - rank(b.feature));
}
