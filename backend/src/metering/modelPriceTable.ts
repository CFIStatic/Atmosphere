/**
 * One price table for provider cost.
 *
 * Token calls are `tokens × usd per million`. Non-token calls (Tavily search,
 * Whisper audio) use the flat rates in this same module. Call sites must not
 * invent their own rates.
 *
 * Defaults match the verification cost knobs and `private.model_costs`:
 * Gemini $0.10 / $0.40 per million, Claude Sonnet-class $3 / $15. Env overrides
 * of those verification rates are read here only, so a deploy can retune cost
 * without editing each meter.
 */

export interface TokenRates {
  inputPerMTok: number;
  outputPerMTok: number;
  /** Cache reads, as a fraction of the input rate. Anthropic default is 0.1. */
  cacheReadFraction: number;
  /** 5-minute cache writes, as a fraction of the input rate. */
  cacheWrite5mFraction: number;
  /** 1-hour cache writes, as a fraction of the input rate. */
  cacheWrite1hFraction: number;
}

export interface ModelPriceRule {
  id: string;
  match: RegExp;
  tokens: TokenRates;
}

export interface ModelPriceTable {
  models: ModelPriceRule[];
  /** Used when the provider is known but the model id is not on the card. */
  providerDefaults: {
    anthropic: TokenRates;
    gemini: TokenRates;
  };
  /** OpenAI Whisper-class speech-to-text, USD per audio minute. */
  whisperUsdPerMinute: number;
  /** Tavily basic search, USD per request. */
  tavilySearchUsd: number;
}

function num(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const CLAUDE_CACHE: Pick<TokenRates, 'cacheReadFraction' | 'cacheWrite5mFraction' | 'cacheWrite1hFraction'> = {
  cacheReadFraction: 0.1,
  cacheWrite5mFraction: 1.25,
  cacheWrite1hFraction: 2,
};

function rates(inputPerMTok: number, outputPerMTok: number): TokenRates {
  return { inputPerMTok, outputPerMTok, ...CLAUDE_CACHE };
}

export function modelPriceTable(env: NodeJS.ProcessEnv = process.env): ModelPriceTable {
  const geminiIn = num(env, 'VERIFICATION_GEMINI_INPUT_USD_PER_MTOK', 0.1);
  const geminiOut = num(env, 'VERIFICATION_GEMINI_OUTPUT_USD_PER_MTOK', 0.4);
  const anthropicIn = num(env, 'VERIFICATION_ANTHROPIC_INPUT_USD_PER_MTOK', 3);
  const anthropicOut = num(env, 'VERIFICATION_ANTHROPIC_OUTPUT_USD_PER_MTOK', 15);
  return {
    providerDefaults: {
      anthropic: rates(anthropicIn, anthropicOut),
      gemini: rates(geminiIn, geminiOut),
    },
    models: [
      { id: 'claude-haiku', match: /^claude-haiku/i, tokens: rates(1, 5) },
      { id: 'claude-sonnet', match: /^claude-sonnet/i, tokens: rates(3, 15) },
      { id: 'claude-opus', match: /^claude-opus/i, tokens: rates(5, 25) },
      { id: 'claude-fable', match: /^claude-fable/i, tokens: rates(10, 50) },
      { id: 'gemini', match: /^gemini/i, tokens: rates(geminiIn, geminiOut) },
    ],
    whisperUsdPerMinute: num(env, 'AI_PRICE_WHISPER_USD_PER_MINUTE', 0.006),
    tavilySearchUsd: num(env, 'AI_PRICE_TAVILY_SEARCH_USD', 0.008),
  };
}

export interface TokenCounts {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWrite5mTokens?: number;
  cacheWrite1hTokens?: number;
  cacheTokens?: number;
}

/** USD for one model call. Null when the model and provider are both unknown. */
export function tokenCostUsd(
  table: ModelPriceTable,
  input: { modelId?: string | null; provider?: string | null; tokens: TokenCounts },
): number | null {
  const ratesFor = ratesForModel(table, input.modelId, input.provider);
  if (!ratesFor) return null;
  const tokens = input.tokens;
  const inputTokens = Math.max(0, Number(tokens.inputTokens ?? 0));
  const outputTokens = Math.max(0, Number(tokens.outputTokens ?? 0));
  const cacheRead = Math.max(0, Number(tokens.cacheReadTokens ?? 0));
  const cache5m = Math.max(0, Number(tokens.cacheWrite5mTokens ?? 0));
  const cache1h = Math.max(0, Number(tokens.cacheWrite1hTokens ?? 0));
  const cacheAggregate = Math.max(0, Number(tokens.cacheTokens ?? 0));
  const unspecifiedCache = Math.max(0, cacheAggregate - cacheRead - cache5m - cache1h);
  const usd =
    (inputTokens / 1e6) * ratesFor.inputPerMTok +
    (outputTokens / 1e6) * ratesFor.outputPerMTok +
    (cacheRead / 1e6) * ratesFor.inputPerMTok * ratesFor.cacheReadFraction +
    (cache5m / 1e6) * ratesFor.inputPerMTok * ratesFor.cacheWrite5mFraction +
    (cache1h / 1e6) * ratesFor.inputPerMTok * ratesFor.cacheWrite1hFraction +
    (unspecifiedCache / 1e6) * ratesFor.inputPerMTok * ratesFor.cacheReadFraction;
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return usd;
}

export function ratesForModel(
  table: ModelPriceTable,
  modelId: string | null | undefined,
  provider?: string | null,
): TokenRates | null {
  const id = (modelId ?? '').trim();
  if (id) {
    const rule = table.models.find((row) => row.match.test(id));
    if (rule) return rule.tokens;
  }
  const p = (provider ?? '').toLowerCase();
  if (p.includes('anthropic') || p.includes('claude') || /^claude/i.test(id)) {
    return table.providerDefaults.anthropic;
  }
  if (p.includes('google') || p.includes('gemini') || /^gemini/i.test(id)) {
    return table.providerDefaults.gemini;
  }
  return null;
}

/** Nanodollars. 1 USD = 1e9. Same integer scale as the token ledger. */
export function usdToNanos(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  const nanos = Math.round(usd * 1_000_000_000);
  if (!Number.isSafeInteger(nanos)) return 0;
  return nanos;
}

export function tokenCostNanos(
  table: ModelPriceTable,
  input: { modelId?: string | null; provider?: string | null; tokens: TokenCounts },
): number {
  const usd = tokenCostUsd(table, input);
  if (usd == null) return 0;
  return usdToNanos(usd);
}

export function whisperCostNanos(table: ModelPriceTable, audioSeconds: number): number {
  if (!Number.isFinite(audioSeconds) || audioSeconds <= 0) return 0;
  return usdToNanos((audioSeconds / 60) * table.whisperUsdPerMinute);
}

export function tavilySearchCostNanos(table: ModelPriceTable, searches = 1): number {
  const n = Math.max(0, Math.round(searches));
  if (n === 0) return 0;
  return usdToNanos(table.tavilySearchUsd * n);
}
