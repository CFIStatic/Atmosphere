/**
 * Provider cost (COGS) for a token count — thin wrapper over the shared
 * pricing module (metering/pricing.ts → modelPriceTable.ts).
 *
 * 0 when the model is not on the official rate card: we never invent a
 * price. Callers that can see that case must flag it (see pricing.ts
 * `providerCostForUsage(...).priced`).
 *
 * Cache tokens without a read/write split are priced as cache reads, the
 * lowest cache rate, so a legacy aggregate never over-charges.
 */

import { providerCostForUsage } from './pricing.js';

export function isGeminiModel(modelId: string | null | undefined): boolean {
  return /^gemini\b/i.test((modelId ?? '').trim());
}

export function fallbackProviderCogsNanos(
  modelId: string | null | undefined,
  tokens: {
    inputTokens?: number;
    outputTokens?: number;
    cacheTokens?: number;
    cacheReadTokens?: number;
    cacheWrite5mTokens?: number;
    cacheWrite1hTokens?: number;
  },
  at: Date | string | null = null,
): number {
  if (!(modelId ?? '').trim()) return 0;
  return providerCostForUsage(modelId, tokens, at).costNanos;
}
