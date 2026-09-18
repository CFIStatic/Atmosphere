/**
 * Provider COGS for models that are not on the Claude rate card.
 *
 * Video analysis already prices Gemini at $0.10 / $0.40 per million tokens
 * (`verificationConfig` defaults) and stores that as cost_nanos. Ask and chat
 * go through `quote_usage`, which errors `unknown_model` for Gemini ids, so
 * those events were written with cost 0 and price 0. Settings then showed
 * token counts with no matching spend.
 *
 * Nanodollars per token = usd_per_mtok * 1e9 / 1e6 = usd_per_mtok * 1000.
 * $0.10 → 100 nanos/token. $0.40 → 400 nanos/token. Same integer maths as
 * `private.price_usage` (`tokens * usd_per_mtok * 1000`).
 */

export const GEMINI_INPUT_NANOS_PER_TOKEN = 100;
export const GEMINI_OUTPUT_NANOS_PER_TOKEN = 400;

export function isGeminiModel(modelId: string | null | undefined): boolean {
  return /^gemini\b/i.test((modelId ?? '').trim());
}

/** Provider COGS in nanodollars. 0 when the model is not a known Gemini id. */
export function fallbackProviderCogsNanos(
  modelId: string | null | undefined,
  tokens: { inputTokens?: number; outputTokens?: number; cacheTokens?: number },
): number {
  if (!isGeminiModel(modelId)) return 0;
  const input = Math.max(0, Math.round(Number(tokens.inputTokens ?? 0)));
  const output = Math.max(0, Math.round(Number(tokens.outputTokens ?? 0)));
  const cache = Math.max(0, Math.round(Number(tokens.cacheTokens ?? 0)));
  if (![input, output, cache].every((n) => Number.isSafeInteger(n))) return 0;
  const nanos =
    input * GEMINI_INPUT_NANOS_PER_TOKEN +
    output * GEMINI_OUTPUT_NANOS_PER_TOKEN +
    cache * GEMINI_INPUT_NANOS_PER_TOKEN;
  if (!Number.isSafeInteger(nanos) || nanos <= 0) return 0;
  return nanos;
}
