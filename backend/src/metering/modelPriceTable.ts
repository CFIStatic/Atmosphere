/**
 * The provider rate card — the ONE place provider cost comes from.
 *
 * Every price below is the provider's own published list price (standard,
 * global, paid tier), checked against the official pricing page on
 * RATE_CARD_VERIFIED_AT. Sources are on each rule. `private.model_costs` in
 * the database mirrors this card (see the 20261003 rate-card migration); a
 * unit test keeps the two in step.
 *
 * Rules:
 *  - Exact model ids (a dated snapshot suffix is allowed). A Sonnet 4.6 price
 *    is not a Sonnet 5 price, so families are never matched by prefix alone.
 *  - A model that is not on the card has NO price. Callers get `null` and must
 *    flag it loudly (log + ledger flag + Analytics health) — never a silent $0
 *    and never a guessed family default.
 *  - Scheduled price changes (Gemini 3.6 Flash doubles on 2027-01-01) are
 *    priced by the time the call happened.
 *
 * Non-token calls (Tavily search credits, OpenAI transcription minutes) are on
 * this card too.
 */

export const RATE_CARD_VERIFIED_AT = '2026-10-02';

export const PRICE_SOURCES = {
  anthropic: 'https://platform.claude.com/docs/en/about-claude/pricing',
  google: 'https://ai.google.dev/gemini-api/docs/pricing',
  tavily: 'https://docs.tavily.com/documentation/api-credits',
  openai: 'https://developers.openai.com/api/docs/pricing',
  browserbase: 'https://www.browserbase.com/pricing',
} as const;

/**
 * Browserbase hosted-browser time, USD per browser hour: the Developer plan's
 * overage rate. Override with COMPUTER_BROWSER_USD_PER_HOUR when the plan
 * changes (Startup is $0.10).
 */
export const DEFAULT_BROWSER_USD_PER_HOUR = 0.12;

function browserUsdPerHour(): number {
  const raw = Number(process.env.COMPUTER_BROWSER_USD_PER_HOUR);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_BROWSER_USD_PER_HOUR;
}

export type PricedProvider = 'anthropic' | 'google' | 'openai' | 'tavily';

export interface TokenRates {
  /** Uncached input, USD per million tokens. */
  inputPerMTok: number;
  /** Output, including thinking/reasoning tokens. */
  outputPerMTok: number;
  /** Cache hits / refreshes. */
  cacheReadPerMTok: number;
  /** Anthropic 5-minute cache writes. Gemini has no write charge (storage is billed per hour). */
  cacheWrite5mPerMTok: number;
  /** Anthropic 1-hour cache writes. */
  cacheWrite1hPerMTok: number;
  /** Audio input, where the provider prices it differently (Gemini 2.5 Flash family). */
  audioInputPerMTok?: number;
  audioCacheReadPerMTok?: number;
  /** Long-context tier: every token of a prompt above the threshold is billed at these rates. */
  longContext?: {
    abovePromptTokens: number;
    inputPerMTok: number;
    outputPerMTok: number;
    cacheReadPerMTok: number;
  };
}

export interface ModelPriceRule {
  id: string;
  provider: 'anthropic' | 'google';
  match: RegExp;
  tokens: TokenRates;
  /** Later prices that replace `tokens` from an instant (UTC). Sorted ascending. */
  schedule?: Array<{ from: string; tokens: TokenRates }>;
  source: string;
}

export interface ModelPriceTable {
  verifiedAt: string;
  models: ModelPriceRule[];
  /** OpenAI speech-to-text, USD per audio minute, by model. */
  transcriptionUsdPerMinute: Record<string, number>;
  /** @deprecated Kept for older callers: whisper-1 per-minute price. */
  whisperUsdPerMinute: number;
  /** Tavily pay-as-you-go, USD per API credit. Search basic 1 / advanced 2; extract 1 or 2 per 5 URLs. */
  tavilyUsdPerCredit: number;
  /** @deprecated Kept for older callers: one basic search. */
  tavilySearchUsd: number;
  /** Hosted browser (Browserbase) for Chat's Computer, USD per browser hour. */
  browserUsdPerHour: number;
}

/** Anthropic: 5m write 1.25×, 1h write 2×, read 0.1× of base input. */
function claude(inputPerMTok: number, outputPerMTok: number, readMultiplier = 0.1): TokenRates {
  return {
    inputPerMTok,
    outputPerMTok,
    cacheReadPerMTok: round6(inputPerMTok * readMultiplier),
    cacheWrite5mPerMTok: round6(inputPerMTok * 1.25),
    cacheWrite1hPerMTok: round6(inputPerMTok * 2),
  };
}

function gemini(inputPerMTok: number, outputPerMTok: number, cacheReadPerMTok: number, extra: Partial<TokenRates> = {}): TokenRates {
  return {
    inputPerMTok,
    outputPerMTok,
    cacheReadPerMTok,
    cacheWrite5mPerMTok: 0,
    cacheWrite1hPerMTok: 0,
    ...extra,
  };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** `^id` optionally followed by a dated snapshot (`-20260724`) or `-latest`. */
function exact(id: string): RegExp {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^(?:models/)?${escaped}(?:-\\d{8}|-\\d{3}|-latest|@\\d{8})?$`, 'i');
}

const A = PRICE_SOURCES.anthropic;
const G = PRICE_SOURCES.google;

const MODELS: ModelPriceRule[] = [
  // Anthropic — Claude API, standard (global) pricing. Long context: "Claude
  // 4.6 and later include the full 1M token context window at standard pricing".
  { id: 'claude-fable-5', provider: 'anthropic', match: exact('claude-fable-5'), tokens: claude(10, 50), source: A },
  { id: 'claude-opus-5', provider: 'anthropic', match: exact('claude-opus-5'), tokens: claude(5, 25), source: A },
  { id: 'claude-opus-4-8', provider: 'anthropic', match: exact('claude-opus-4-8'), tokens: claude(5, 25), source: A },
  // Sonnet 5's $2/$10 launch price "is now the standard price"; the scheduled
  // move to $3/$15 on 2026-09-01 "will not occur".
  { id: 'claude-sonnet-5', provider: 'anthropic', match: exact('claude-sonnet-5'), tokens: claude(2, 10), source: A },
  { id: 'claude-sonnet-4-6', provider: 'anthropic', match: exact('claude-sonnet-4-6'), tokens: claude(3, 15), source: A },
  { id: 'claude-haiku-4-5', provider: 'anthropic', match: exact('claude-haiku-4-5'), tokens: claude(1, 5), source: A },

  // Google — Gemini Developer API, paid tier, standard. Output includes thinking tokens.
  {
    id: 'gemini-3.6-flash',
    provider: 'google',
    match: exact('gemini-3.6-flash'),
    tokens: gemini(0.75, 3.75, 0.075),
    schedule: [{ from: '2027-01-01T00:00:00Z', tokens: gemini(1.5, 7.5, 0.15) }],
    source: G,
  },
  { id: 'gemini-3.5-flash', provider: 'google', match: exact('gemini-3.5-flash'), tokens: gemini(1.5, 9, 0.15), source: G },
  { id: 'gemini-3.5-flash-lite', provider: 'google', match: exact('gemini-3.5-flash-lite'), tokens: gemini(0.3, 2.5, 0.03), source: G },
  {
    id: 'gemini-2.5-flash',
    provider: 'google',
    match: exact('gemini-2.5-flash'),
    tokens: gemini(0.3, 2.5, 0.03, { audioInputPerMTok: 1, audioCacheReadPerMTok: 0.1 }),
    source: G,
  },
  {
    id: 'gemini-2.5-flash-lite',
    provider: 'google',
    match: exact('gemini-2.5-flash-lite'),
    tokens: gemini(0.1, 0.4, 0.01, { audioInputPerMTok: 0.3, audioCacheReadPerMTok: 0.03 }),
    source: G,
  },
  {
    id: 'gemini-2.5-pro',
    provider: 'google',
    match: exact('gemini-2.5-pro'),
    tokens: gemini(1.25, 10, 0.125, {
      longContext: { abovePromptTokens: 200_000, inputPerMTok: 2.5, outputPerMTok: 15, cacheReadPerMTok: 0.25 },
    }),
    source: G,
  },
  {
    id: 'gemini-3.1-pro-preview',
    provider: 'google',
    match: /^(?:models\/)?gemini-3\.1-pro-preview(?:-customtools)?$/i,
    tokens: gemini(2, 12, 0.2, {
      longContext: { abovePromptTokens: 200_000, inputPerMTok: 4, outputPerMTok: 18, cacheReadPerMTok: 0.4 },
    }),
    source: G,
  },
];

export function modelPriceTable(): ModelPriceTable {
  return {
    verifiedAt: RATE_CARD_VERIFIED_AT,
    models: MODELS,
    transcriptionUsdPerMinute: {
      'whisper-1': 0.006,
      'gpt-4o-transcribe': 0.006,
      'gpt-4o-mini-transcribe': 0.003,
      'gpt-transcribe': 0.0045,
    },
    whisperUsdPerMinute: 0.006,
    tavilyUsdPerCredit: 0.008,
    tavilySearchUsd: 0.008,
    browserUsdPerHour: browserUsdPerHour(),
  };
}

export interface TokenCounts {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWrite5mTokens?: number;
  cacheWrite1hTokens?: number;
  /**
   * Legacy aggregate with no read/write split. Priced as cache READS — the
   * lowest cache rate — so an ambiguous historical row is never over-charged.
   */
  cacheTokens?: number;
  /** Portion of inputTokens that is audio (Gemini modality pricing). */
  audioInputTokens?: number;
  /** Whole prompt size for long-context tiers (input + cached). Defaults to input + cache. */
  promptTokens?: number;
}

export function priceRuleFor(table: ModelPriceTable, modelId: string | null | undefined): ModelPriceRule | null {
  const id = (modelId ?? '').trim();
  if (!id) return null;
  return table.models.find((row) => row.match.test(id)) ?? null;
}

/** Rates in force for a model at an instant. Null when the model is not on the card. */
export function ratesForModel(
  table: ModelPriceTable,
  modelId: string | null | undefined,
  at: Date | string | null = null,
): TokenRates | null {
  const rule = priceRuleFor(table, modelId);
  if (!rule) return null;
  const when = at == null ? Date.now() : typeof at === 'string' ? Date.parse(at) : at.getTime();
  let rates = rule.tokens;
  for (const step of rule.schedule ?? []) {
    if (Number.isFinite(when) && when >= Date.parse(step.from)) rates = step.tokens;
  }
  return rates;
}

function nonNeg(n: unknown): number {
  const v = Number(n ?? 0);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** USD for one model call. Null when the model is not on the card. */
export function tokenCostUsd(
  table: ModelPriceTable,
  input: { modelId?: string | null; provider?: string | null; tokens: TokenCounts; at?: Date | string | null },
): number | null {
  const base = ratesForModel(table, input.modelId, input.at ?? null);
  if (!base) return null;
  const t = input.tokens;
  const inputTokens = nonNeg(t.inputTokens);
  const outputTokens = nonNeg(t.outputTokens);
  const cacheRead = nonNeg(t.cacheReadTokens);
  const cache5m = nonNeg(t.cacheWrite5mTokens);
  const cache1h = nonNeg(t.cacheWrite1hTokens);
  const unspecifiedCache = Math.max(0, nonNeg(t.cacheTokens) - cacheRead - cache5m - cache1h);
  const audio = Math.min(inputTokens, nonNeg(t.audioInputTokens));
  const prompt = t.promptTokens != null ? nonNeg(t.promptTokens) : inputTokens + cacheRead + cache5m + cache1h + unspecifiedCache;

  const long = base.longContext && prompt > base.longContext.abovePromptTokens ? base.longContext : null;
  const inRate = long ? long.inputPerMTok : base.inputPerMTok;
  const outRate = long ? long.outputPerMTok : base.outputPerMTok;
  const readRate = long ? long.cacheReadPerMTok : base.cacheReadPerMTok;
  const audioRate = base.audioInputPerMTok ?? inRate;

  const usd =
    ((inputTokens - audio) / 1e6) * inRate +
    (audio / 1e6) * audioRate +
    (outputTokens / 1e6) * outRate +
    ((cacheRead + unspecifiedCache) / 1e6) * readRate +
    (cache5m / 1e6) * base.cacheWrite5mPerMTok +
    (cache1h / 1e6) * base.cacheWrite1hPerMTok;
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return usd;
}

/** Nanodollars. 1 USD = 1e9. Same integer scale as the token ledger. */
export function usdToNanos(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  const nanos = Math.round(usd * 1_000_000_000);
  if (!Number.isSafeInteger(nanos)) return 0;
  return nanos;
}

/** Nanodollars for one call; 0 when the model is not on the card (use tokenCostUsd to tell the two apart). */
export function tokenCostNanos(
  table: ModelPriceTable,
  input: { modelId?: string | null; provider?: string | null; tokens: TokenCounts; at?: Date | string | null },
): number {
  const usd = tokenCostUsd(table, input);
  if (usd == null) return 0;
  return usdToNanos(usd);
}

export function transcriptionCostNanos(table: ModelPriceTable, modelId: string, audioSeconds: number): number | null {
  const perMinute = table.transcriptionUsdPerMinute[(modelId || '').trim().toLowerCase()];
  if (perMinute == null) return null;
  if (!Number.isFinite(audioSeconds) || audioSeconds <= 0) return 0;
  return usdToNanos((audioSeconds / 60) * perMinute);
}

export function whisperCostNanos(table: ModelPriceTable, audioSeconds: number): number {
  return transcriptionCostNanos(table, 'whisper-1', audioSeconds) ?? 0;
}

/** Tavily credits → nanodollars. Basic search is 1 credit, advanced 2. */
export function tavilyCreditsCostNanos(table: ModelPriceTable, credits = 1): number {
  const n = Math.max(0, Number(credits) || 0);
  if (n === 0) return 0;
  return usdToNanos(table.tavilyUsdPerCredit * n);
}

/**
 * Hosted browser time → nanodollars. Billed in whole minutes with a
 * one-minute minimum, the way Browserbase bills.
 */
export function browserMinutes(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 1;
  return Math.max(1, Math.ceil(seconds / 60));
}

export function browserTimeCostNanos(table: ModelPriceTable, seconds: number): number {
  return usdToNanos((browserMinutes(seconds) / 60) * table.browserUsdPerHour);
}

export function tavilySearchCostNanos(table: ModelPriceTable, searches = 1): number {
  return tavilyCreditsCostNanos(table, Math.max(0, Math.round(searches)));
}

export type TavilyCall =
  | { endpoint: 'search'; depth?: 'basic' | 'advanced' | null }
  | { endpoint: 'extract'; depth?: 'basic' | 'advanced' | null; successfulUrls: number };

/**
 * Credits Tavily charges for one call, from the published credit table
 * (https://docs.tavily.com/documentation/api-credits, checked 2026-10-03):
 *
 * - Search: basic 1 credit, advanced 2 credits per request.
 * - Extract: every 5 successful URL extractions cost 1 credit (basic) or
 *   2 credits (advanced); failed URLs are free. A partial block of 5 is
 *   counted as a full one (rounded up).
 *
 * Used only when the response carries no `usage.credits`; the provider's own
 * number always wins.
 */
export function tavilyDocumentedCredits(call: TavilyCall): number {
  const perUnit = call.depth === 'advanced' ? 2 : 1;
  if (call.endpoint === 'search') return perUnit;
  const urls = Math.max(0, Math.floor(Number(call.successfulUrls) || 0));
  if (urls === 0) return 0;
  return Math.ceil(urls / 5) * perUnit;
}

/** Credits to bill: provider-reported `usage.credits` when present, else the documented table. */
export function tavilyBilledCredits(
  call: TavilyCall,
  reported: unknown,
): { credits: number; reportedByProvider: boolean } {
  const n = Number(reported);
  if (reported !== null && reported !== undefined && Number.isFinite(n) && n >= 0) {
    return { credits: n, reportedByProvider: true };
  }
  return { credits: tavilyDocumentedCredits(call), reportedByProvider: false };
}
