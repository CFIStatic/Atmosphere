/**
 * Text completion for Ask (job file, clip, proof Q&A).
 *
 * Production often has a working Gemini key (clip readings already use it)
 * and no Anthropic key. Ask used to require Anthropic only, so the office
 * chat fell back to keyword matching and answered "The videos on file do
 * not show that" for ordinary questions.
 *
 * Interactive Ask prefers Anthropic (Opus / strong Sonnet via ANTHROPIC_MODEL)
 * when ANTHROPIC_API_KEY is present — streaming for snappy, high-quality prose.
 * Gemini Flash-Lite remains the fallback when Anthropic is unset, with thinking
 * off / minimal and a modest output budget. Conversation analysis and other
 * offline extractors opt into `mode: 'analysis'` for more headroom.
 *
 * Order: organisation / server Anthropic key, then Gemini. Failures are
 * logged and the next provider is tried. Callers keep their grounded
 * answer when nothing is configured or every provider fails.
 */
import { geminiMeasuredUsage } from './providerUsage.js';
import {
  anthropicClientForKey,
  tryExtractUsage,
  type MeasuredUsage,
} from './anthropic.js';
import { googleVisionApiKey } from './visionProvider.js';
import { logger } from './logger.js';
import { meterBackgroundUsage } from '../metering/backgroundUsage.js';
import { currentAiUsageScope } from '../metering/aiUsageContext.js';
import { isRetiredAnthropicModel, resolveAnthropicModel } from './anthropicModel.js';
import {
  anthropicCachedSystem,
  asAnthropicSystem,
  geminiCachedContentName,
  geminiSystemPrefix,
} from '../shared/askPromptCache.js';

export type AskProvider = 'anthropic' | 'google' | 'unconfigured';

/** Interactive Ask — short office replies. Anthropic counts only visible output. */
export const ANTHROPIC_ASK_MAX_TOKENS = 2048;
/**
 * Interactive Gemini Ask output budget. Thinking models used to burn a 20k
 * ceiling on hidden reasoning first; interactive Ask keeps this modest so the
 * first visible token arrives quickly.
 */
export const GEMINI_ASK_MAX_TOKENS = 2048;
/**
 * Analysis / extraction calls (conversation brief, evidence fusion, etc.) may
 * raise this via `maxTokens`. Kept as a separate constant for callers and tests.
 */
export const GEMINI_ASK_ANALYSIS_MAX_TOKENS = 12_288;
/** Interactive Ask: no deep thinking — first token ASAP. */
export const GEMINI_ASK_THINKING_LEVEL = 'minimal';
/** Offline Analysis: strong thinking for dense reconstruction (never invent). */
export const GEMINI_ASK_ANALYSIS_THINKING_LEVEL = 'high';
/**
 * Gemini 2.5 Pro is retired (the API 404s). Analysis and the Ask lookup
 * fallback use this id unless ASK_ANALYSIS_MODEL names a model Google still serves.
 */
export const GEMINI_ANALYSIS_MODEL_DEFAULT = 'gemini-3.1-pro-preview';
/**
 * Adaptive thinking counts toward max_tokens. 2048 is too small for a tool
 * loop on Opus 4.7+ / Opus 5; this leaves room for thinking and the answer.
 */
export const ANTHROPIC_REASONING_MAX_TOKENS = 16_000;

export type AnthropicEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

const RETIRED_GEMINI_ANALYSIS = /^(?:gemini-2\.5-pro|gemini-2\.0-pro|gemini-1\.5-pro|gemini-pro)(?:-|$)/i;
/** Fast / interactive Gemini pins we supersede when Railway still names 2.5 flash. */
const SUPERSEDED_GEMINI_FAST = /^(?:gemini-2\.5-flash(?:-lite)?|gemini-2\.0-flash(?:-lite)?)(?:-|$)/i;

export type AskCompletionMode = 'interactive' | 'analysis' | 'reasoning';

/** Per-provider cap for extended-thinking Ask. A hung call falls through to Gemini. */
export const ASK_REASONING_TIMEOUT_MS_DEFAULT = 32_000;

export function askReasoningTimeoutMs(): number {
  const raw = Number(process.env.ASK_REASONING_TIMEOUT_MS);
  if (!Number.isFinite(raw)) return ASK_REASONING_TIMEOUT_MS_DEFAULT;
  return Math.min(120_000, Math.max(8_000, Math.round(raw)));
}

/** Extended-thinking budget from ASK_ANALYSIS_THINKING_LEVEL. Off disables it. */
export function askReasoningThinkingBudget(): number | null {
  const level = (process.env.ASK_ANALYSIS_THINKING_LEVEL ?? 'high').trim().toLowerCase();
  if (level === 'off' || level === 'none' || level === 'minimal') return null;
  if (level === 'low') return 1024;
  if (level === 'medium') return 4096;
  if (level === 'xhigh') return 12_000;
  return 8000;
}

export function askReasoningConfig(): {
  anthropicModel: string;
  geminiModel: string;
  thinkingLevel: string;
  thinkingBudget: number | null;
  timeoutMs: number;
} {
  return {
    anthropicModel: anthropicAskModel(),
    geminiModel: geminiAskModel('analysis'),
    thinkingLevel: (process.env.ASK_ANALYSIS_THINKING_LEVEL ?? 'high').trim() || 'high',
    thinkingBudget: askReasoningThinkingBudget(),
    timeoutMs: askReasoningTimeoutMs(),
  };
}

export type AskModelResult = {
  text: string;
  model: string;
  usage: MeasuredUsage | null;
};

export type AskStreamHandlers = {
  onToken?: (text: string) => void;
};

export function anthropicAskApiKey(): string {
  return (process.env.ANTHROPIC_API_KEY ?? '').trim();
}

export function askProviderLabel(): AskProvider {
  if (anthropicAskApiKey()) return 'anthropic';
  if (googleVisionApiKey()) return 'google';
  return 'unconfigured';
}

export function isAskModelConfigured(anthropicApiKey?: string | null): boolean {
  return Boolean((anthropicApiKey ?? anthropicAskApiKey()).trim() || googleVisionApiKey());
}

function anthropicAskModel(): string {
  return resolveAnthropicModel(process.env.ANTHROPIC_MODEL, process.env.ANTHROPIC_DEFAULT_MODEL);
}

/** Known-retired analysis ids. Callers still retry a 404 the API suggests a replacement for. */
export function isRetiredGeminiAnalysisModel(model: string): boolean {
  return RETIRED_GEMINI_ANALYSIS.test(model.trim().toLowerCase());
}

/**
 * Map a configured analysis model onto one Gemini still serves.
 * An explicit current id is left alone. gemini-2.5-pro and the other
 * retired pro ids become GEMINI_ANALYSIS_MODEL_DEFAULT.
 */
export function resolveGeminiAskModel(model: string, mode: AskCompletionMode = 'analysis'): string {
  const id = model.trim();
  const deep = mode === 'analysis' || mode === 'reasoning';
  if (!id) {
    return deep ? GEMINI_ANALYSIS_MODEL_DEFAULT : 'gemini-3.5-flash-lite';
  }
  // Analysis/vision must not stay pinned to Anthropic ids (e.g. VERIFICATION_PRIMARY_MODEL
  // or ASK_ANALYSIS_MODEL accidentally set to claude-opus-*). Remap to Gemini 3.1 Pro.
  if (deep && /^claude-/i.test(id)) {
    return GEMINI_ANALYSIS_MODEL_DEFAULT;
  }
  if (deep && isRetiredGeminiAnalysisModel(id)) {
    return GEMINI_ANALYSIS_MODEL_DEFAULT;
  }
  // 2.5 flash family is limited to prior users; move interactive/fast calls to 3.x.
  if (!deep && SUPERSEDED_GEMINI_FAST.test(id)) {
    return /lite/i.test(id) ? 'gemini-3.5-flash-lite' : 'gemini-3.8-flash';
  }
  if (deep && SUPERSEDED_GEMINI_FAST.test(id)) {
    return GEMINI_ANALYSIS_MODEL_DEFAULT;
  }
  return id;
}

/**
 * Opus 4.5 and older still require thinking.type "enabled" plus budget_tokens.
 * Opus 4.6+ accepts adaptive thinking; Opus 4.7+ and Opus 5 reject budget_tokens.
 */
export function anthropicUsesBudgetTokens(model: string): boolean {
  const id = model.trim().toLowerCase();
  if (/^claude-3(?:[.-]|$)/.test(id)) return true;
  const match = id.match(/claude-(?:opus|sonnet|haiku)-(\d+)(?:[.-](\d+))?/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = match[2] != null ? Number(match[2]) : 0;
  return major < 4 || (major === 4 && minor <= 5);
}

/** ASK_ANALYSIS_THINKING_LEVEL → output_config.effort. Off leaves thinking unset. */
export function askAnalysisEffort(): AnthropicEffort | null {
  const level = (process.env.ASK_ANALYSIS_THINKING_LEVEL ?? 'high').trim().toLowerCase();
  if (level === 'off' || level === 'none' || level === 'minimal') return null;
  if (level === 'low') return 'low';
  if (level === 'medium') return 'medium';
  if (level === 'xhigh') return 'xhigh';
  if (level === 'max') return 'max';
  return 'high';
}

/**
 * Request fields for a reasoning Ask turn.
 * claude-opus-5 uses thinking.type "adaptive" plus output_config.effort.
 * budget_tokens is only attached for models that still require it.
 */
export function anthropicReasoningRequest(model: string, effortOverride?: AnthropicEffort | null): {
  max_tokens: number;
  thinking?: { type: 'adaptive' } | { type: 'enabled'; budget_tokens: number };
  output_config?: { effort: AnthropicEffort };
} {
  const configured = askAnalysisEffort();
  // An override only applies when thinking is on at all.
  const effort = configured && effortOverride ? effortOverride : configured;
  const budget = askReasoningThinkingBudget();
  if (!effort || budget == null) return { max_tokens: ANTHROPIC_REASONING_MAX_TOKENS };
  if (anthropicUsesBudgetTokens(model)) {
    const budgetTokens = Math.max(1024, budget);
    return {
      max_tokens: Math.max(ANTHROPIC_REASONING_MAX_TOKENS, budgetTokens + 1024),
      thinking: { type: 'enabled', budget_tokens: budgetTokens },
    };
  }
  return {
    max_tokens: ANTHROPIC_REASONING_MAX_TOKENS,
    thinking: { type: 'adaptive' },
    output_config: { effort },
  };
}

/**
 * Effort for an interactive deep Ask turn (Opus with adaptive thinking).
 * Drafts, disputes, money, safety, deadlines, and research keep the analysis
 * effort (high by default); everyday deep job questions use medium so the
 * first sentence is not waiting on a long hidden think. ASK_DEEP_EFFORT=high
 * restores the old behaviour.
 */
export function askInteractiveDeepEffort(): AnthropicEffort {
  const raw = (process.env.ASK_DEEP_EFFORT ?? 'medium').trim().toLowerCase();
  if (raw === 'low' || raw === 'medium' || raw === 'high' || raw === 'xhigh' || raw === 'max') return raw;
  return 'medium';
}

/**
 * Sonnet-class model for simple Ask turns. Same Anthropic key as Opus.
 * Override with ASK_FAST_ANTHROPIC_MODEL (a Haiku id is fine when that key serves it).
 */
export const ASK_FAST_ANTHROPIC_DEFAULT = 'claude-sonnet-5-5';

export function askFastAnthropicModel(): string {
  const configured = (process.env.ASK_FAST_ANTHROPIC_MODEL ?? '').trim();
  if (!configured || isRetiredAnthropicModel(configured)) return ASK_FAST_ANTHROPIC_DEFAULT;
  return configured;
}

/** Gemini Flash for a fast Ask turn when Anthropic is unset. */
export function askFastGeminiModel(): string {
  const configured = (process.env.ASK_FAST_MODEL ?? process.env.GOOGLE_MODEL_FAST ?? '').trim();
  return resolveGeminiAskModel(configured || 'gemini-3.8-flash', 'interactive');
}

/** Fast Ask turns do not spend the output budget on thinking. */
export const ANTHROPIC_FAST_MAX_TOKENS = 4096;

export function anthropicFastRequest(): { max_tokens: number } {
  return { max_tokens: ANTHROPIC_FAST_MAX_TOKENS };
}

/** Low-latency interactive Ask model (override with ASK_MODEL / ASK_FAST_MODEL). */
export function geminiAskModel(mode: AskCompletionMode = 'interactive'): string {
  if (mode === 'analysis' || mode === 'reasoning') {
    const configured = (
      process.env.ASK_ANALYSIS_MODEL ??
      process.env.VERIFICATION_PRIMARY_MODEL ??
      GEMINI_ANALYSIS_MODEL_DEFAULT
    ).trim();
    return resolveGeminiAskModel(configured, mode);
  }
  const configured = (
    process.env.ASK_MODEL ??
    process.env.ASK_FAST_MODEL ??
    process.env.GOOGLE_MODEL_FAST ??
    'gemini-3.5-flash-lite'
  ).trim();
  return resolveGeminiAskModel(configured, mode);
}

function geminiThinkingLevel(mode: AskCompletionMode): string {
  const deep = mode === 'analysis' || mode === 'reasoning';
  const fromEnv = deep
    ? (process.env.ASK_ANALYSIS_THINKING_LEVEL ?? '').trim()
    : (process.env.ASK_THINKING_LEVEL ?? '').trim();
  if (fromEnv) return fromEnv;
  return deep ? GEMINI_ASK_ANALYSIS_THINKING_LEVEL : GEMINI_ASK_THINKING_LEVEL;
}

function geminiBaseUrl(): string {
  return (process.env.GOOGLE_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
}

const PROVIDER_SECRET_RE =
  /\b(?:sk-ant-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,}|ya29\.[0-9A-Za-z._-]+|Bearer\s+[A-Za-z0-9._~+/-]{12,})\b/gi;

/** Drop API keys and collapse whitespace. Safe to put in a log line. */
export function scrubProviderDetail(value: string): string {
  return value.replace(PROVIDER_SECRET_RE, '[redacted]').replace(/\s+/g, ' ').trim();
}

export function describeProviderError(err: unknown): { status: number | null; code: string | null; detail: string } {
  let status: number | null = null;
  let code: string | null = null;
  let message = err instanceof Error ? err.message : String(err);
  if (err && typeof err === 'object') {
    const rec = err as { status?: unknown; type?: unknown; error?: { type?: unknown; message?: unknown } };
    if (typeof rec.status === 'number') status = rec.status;
    if (typeof rec.type === 'string' && rec.type && rec.type !== 'error') code = rec.type;
    const nested = rec.error;
    if (nested && typeof nested === 'object') {
      if (typeof nested.type === 'string' && nested.type) code = nested.type;
      if (typeof nested.message === 'string' && nested.message.trim()) message = nested.message;
    }
  }
  if (status == null) {
    const match = message.match(/\b(?:error|status)\s+(\d{3})\b/i);
    if (match) status = Number(match[1]);
  }
  if (!code) {
    const typeMatch = message.match(
      /\b(invalid_request_error|authentication_error|permission_error|not_found_error|rate_limit_error|api_error|INVALID_ARGUMENT|NOT_FOUND|PERMISSION_DENIED)\b/,
    );
    if (typeMatch) code = typeMatch[1] ?? null;
  }
  return { status, code, detail: scrubProviderDetail(message).slice(0, 240) };
}

/**
 * Railway's log view shows the message, not nested fields. Keep status and
 * the provider's error text in the message, with secrets stripped.
 */
export function logAskFailure(event: string, err: unknown): void {
  const info = describeProviderError(err);
  const status = info.status == null ? 'none' : String(info.status);
  const code = info.code ?? 'error';
  logger.warn(`${event} status=${status} code=${code} ${info.detail}`, {
    status: info.status,
    code,
    detail: info.detail,
  });
}

function resolveMaxTokens(input: { maxTokens?: number; mode?: AskCompletionMode }): {
  anthropicMax: number;
  geminiMax: number;
} {
  const mode = input.mode ?? 'interactive';
  const fallback =
    mode === 'interactive' ? ANTHROPIC_ASK_MAX_TOKENS : GEMINI_ASK_ANALYSIS_MAX_TOKENS;
  const anthropicMax = input.maxTokens ?? fallback;
  const geminiFloor = mode === 'interactive' ? GEMINI_ASK_MAX_TOKENS : GEMINI_ASK_ANALYSIS_MAX_TOKENS;
  // Honour an explicit higher maxTokens (e.g. conversation brief) without
  // forcing the old 20k interactive ceiling onto every call.
  const geminiMax = Math.max(anthropicMax, input.maxTokens != null ? anthropicMax : geminiFloor);
  return { anthropicMax, geminiMax };
}

/**
 * Gemini 3 only accepts thinkingLevel low or high. thinkingBudget on a
 * gemini-3 model (and thinkingLevel values such as minimal or medium on
 * gemini-3.1-pro) is rejected immediately. Never send both.
 */
export function gemini3ThinkingLevel(level: string): 'low' | 'high' {
  const value = level.trim().toLowerCase();
  if (value === 'high' || value === 'xhigh' || value === 'max' || value === 'medium') return 'high';
  return 'low';
}

export function buildGeminiGenerationConfig(input: {
  model: string;
  maxTokens: number;
  mode: AskCompletionMode;
}): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: input.maxTokens,
  };
  const level = geminiThinkingLevel(input.mode);
  // Flash-Lite / non-thinking ids reject thinkingConfig; only attach when useful.
  if (/^gemini-3/i.test(input.model)) {
    // Gemini 3 reasoning is tuned for the default temperature. Don't send 0.
    // Lite variants reject thinkingConfig entirely.
    if (!/lite/i.test(input.model)) {
      if (level !== 'none' && level !== 'off' && level !== 'minimal') {
        generationConfig.thinkingConfig = { thinkingLevel: gemini3ThinkingLevel(level) };
      } else {
        // Omitting thinkingConfig does NOT turn thinking off on Gemini 3: the
        // model falls back to its default (high) and interactive Ask waited
        // 6–9 s for the first token. "low" is the lowest level every Gemini 3
        // model accepts.
        generationConfig.thinkingConfig = { thinkingLevel: 'low' };
      }
    }
  } else {
    generationConfig.temperature = 0;
  }
  if (/^gemini-2\.5/i.test(input.model) && !/lite/i.test(input.model)) {
    // 2.5 Flash/Pro: thinkingBudget 0 disables hidden reasoning for interactive Ask.
    if (input.mode === 'interactive' || level === 'none' || level === 'off' || level === 'minimal') {
      generationConfig.thinkingConfig = { thinkingBudget: 0 };
    } else if (level === 'low') {
      generationConfig.thinkingConfig = { thinkingBudget: 1024 };
    } else if (level === 'medium') {
      generationConfig.thinkingConfig = { thinkingBudget: 4096 };
    } else {
      // high / xhigh — denser Analysis reconstruction headroom
      generationConfig.thinkingConfig = { thinkingBudget: 8192 };
    }
  }
  return generationConfig;
}

function anthropicSystem(system: string, stable?: string | null): string | ReturnType<typeof asAnthropicSystem> {
  const prefix = (stable ?? '').trim();
  if (!prefix) return system;
  return asAnthropicSystem(anthropicCachedSystem(system, prefix));
}

/** Visible reply text from an Anthropic messages response (skips thinking blocks). */
export function anthropicVisibleText(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n')
    .trim();
}

async function completeWithAnthropic(input: {
  apiKey: string;
  system: string;
  /** Stable prefix cached with the system prompt. Omitted from the user text. */
  stable?: string | null;
  user: string;
  maxTokens: number;
  onToken?: (text: string) => void;
  reasoning?: boolean;
  signal?: AbortSignal;
  model?: string;
}): Promise<AskModelResult> {
  const model = (input.model ?? '').trim() || anthropicAskModel();
  const shaped = input.reasoning ? anthropicReasoningRequest(model) : null;
  const maxTokens = shaped?.max_tokens ?? input.maxTokens;
  const system = anthropicSystem(input.system, input.stable);
  const extra = shaped
    ? {
        ...(shaped.thinking ? { thinking: shaped.thinking } : {}),
        ...(shaped.output_config ? { output_config: shaped.output_config } : {}),
      }
    : {};

  const runOnce = async (
    user: string,
    tokens: number,
    streamTokens: boolean,
  ): Promise<{
    text: string;
    model: string;
    usage: MeasuredUsage | null;
    stopReason: string | null;
    blockTypes: string[];
  }> => {
    if (streamTokens && input.onToken) {
      const stream = anthropicClientForKey(input.apiKey).messages.stream(
        {
          model,
          max_tokens: tokens,
          system,
          messages: [{ role: 'user', content: user }],
          ...extra,
        },
        input.signal ? { signal: input.signal } : undefined,
      );
      let text = '';
      stream.on('text', (delta: string) => {
        if (!delta) return;
        text += delta;
        input.onToken?.(delta);
      });
      const response = await stream.finalMessage();
      const blockTypes = (response.content ?? []).map((b: { type: string }) => b.type);
      text =
        text.trim() ||
        anthropicVisibleText(response.content as Array<{ type: string; text?: string }>);
      return {
        text,
        model: response.model,
        usage: tryExtractUsage(response.usage, response.model ?? null),
        stopReason: (response as { stop_reason?: string | null }).stop_reason ?? null,
        blockTypes,
      };
    }
    const response = await anthropicClientForKey(input.apiKey).messages.create(
      {
        model,
        max_tokens: tokens,
        system,
        messages: [{ role: 'user', content: user }],
        ...extra,
      },
      input.signal ? { signal: input.signal } : undefined,
    );
    const blockTypes = (response.content ?? []).map((b: { type: string }) => b.type);
    const text = anthropicVisibleText(response.content as Array<{ type: string; text?: string }>);
    return {
      text,
      model: response.model,
      usage: tryExtractUsage(response.usage, response.model ?? null),
      stopReason: (response as { stop_reason?: string | null }).stop_reason ?? null,
      blockTypes,
    };
  };

  let result = await runOnce(input.user, maxTokens, Boolean(input.onToken));
  if (!result.text) {
    logger.warn(
      `ask_anthropic_empty_reply stop_reason=${result.stopReason ?? 'null'} blocks=${result.blockTypes.join(',') || 'none'} model=${result.model}`,
      { stopReason: result.stopReason, blockTypes: result.blockTypes, model: result.model },
    );
    const retryUser = `${input.user}\n\nRespond with the answer as visible text.`;
    const retryTokens = Math.min(Math.max(maxTokens + 1024, maxTokens), 32_000);
    result = await runOnce(retryUser, retryTokens, false);
  }
  if (!result.text) {
    throw new Error('Anthropic Ask returned an empty reply');
  }
  return { text: result.text, model: result.model, usage: result.usage };
}

export async function completeAnthropicAsk(
  input: Parameters<typeof completeWithAnthropic>[0],
): Promise<AskModelResult> {
  return completeWithAnthropic(input);
}


function visibleGeminiText(part: { text?: string; thought?: boolean }): string {
  if (part.thought) return '';
  return part.text ?? '';
}

function extractGeminiText(payload: {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
}): string {
  return (payload.candidates?.[0]?.content?.parts ?? [])
    .map((part) => visibleGeminiText(part))
    .join('')
    .trim();
}

/**
 * POST generateContent, rewriting a retired model and retrying one 404
 * that names a replacement. The generation config is rebuilt for the
 * model that actually runs, so a gemini-3 retry never keeps thinkingBudget.
 */
export async function requestGemini(input: {
  apiKey: string;
  model: string;
  mode: AskCompletionMode;
  maxTokens: number;
  body: Record<string, unknown>;
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
  stream?: boolean;
}): Promise<{ response: Response; model: string }> {
  const fetchFn = input.fetchFn ?? fetch;
  let model = resolveGeminiAskModel(input.model, input.mode);
  if (model !== input.model.trim()) {
    logger.warn(`ask_gemini_model_retired model=${input.model.trim()} suggested=${model}`, {
      model: input.model.trim(),
      suggested: model,
    });
  }
  let retried = false;
  while (true) {
    const generationConfig = buildGeminiGenerationConfig({
      model,
      maxTokens: input.maxTokens,
      mode: input.mode,
    });
    const method = input.stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
    const url = `${geminiBaseUrl()}/v1beta/models/${encodeURIComponent(model)}:${method}`;
    const response = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': input.apiKey },
      body: JSON.stringify({ ...input.body, generationConfig }),
      signal: input.signal,
    });
    if (response.ok) return { response, model };
    const errText = await response.text();
    const suggestedRaw = errText.match(/use models\/([a-z0-9._-]+)/i)?.[1] ?? '';
    const suggested = suggestedRaw.replace(/[.\s]+$/g, '') || null;
    const retiredFallback =
      response.status === 404 && isRetiredGeminiAnalysisModel(model) ? GEMINI_ANALYSIS_MODEL_DEFAULT : null;
    const next = suggested && suggested !== model ? suggested : retiredFallback && retiredFallback !== model ? retiredFallback : null;
    if (!retried && next) {
      retried = true;
      const detail = scrubProviderDetail(errText).slice(0, 180);
      logger.warn(`ask_gemini_model_retired status=${response.status} model=${model} suggested=${next} ${detail}`, {
        status: response.status,
        model,
        suggested: next,
        detail,
      });
      model = next;
      continue;
    }
    throw new Error(`Gemini Ask error ${response.status}: ${scrubProviderDetail(errText).slice(0, 300)}`);
  }
}

async function completeWithGemini(input: {
  apiKey: string;
  system: string;
  stable?: string | null;
  user: string;
  maxTokens: number;
  mode: AskCompletionMode;
  model?: string;
  fetchFn?: typeof fetch;
  onToken?: (text: string) => void;
  signal?: AbortSignal;
}): Promise<AskModelResult> {
  const requested = input.model || geminiAskModel(input.mode);
  const stable = (input.stable ?? '').trim();
  const cacheName = stable
    ? geminiCachedContentName({
        apiKey: input.apiKey,
        model: requested,
        system: input.system,
        stable,
        fetchFn: input.fetchFn,
      })
    : null;
  const posted = await requestGemini({
    apiKey: input.apiKey,
    model: requested,
    mode: input.mode,
    maxTokens: input.maxTokens,
    fetchFn: input.fetchFn,
    signal: input.signal,
    stream: Boolean(input.onToken),
    body: cacheName
      ? {
          cachedContent: cacheName,
          contents: [{ role: 'user', parts: [{ text: input.user }] }],
        }
      : {
          system_instruction: { parts: [{ text: stable ? geminiSystemPrefix(input.system, stable) : input.system }] },
          contents: [{ role: 'user', parts: [{ text: input.user }] }],
        },
  });
  const model = posted.model;
  const response = posted.response;

  if (input.onToken) {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Gemini Ask stream returned no body');
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let modelVersion = model;
    let usageMetadata: unknown = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n');
      buffer = chunks.pop() ?? '';
      for (const line of chunks) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const raw = trimmed.slice(5).trim();
        if (!raw || raw === '[DONE]') continue;
        let payload: {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
          usageMetadata?: Record<string, unknown>;
          modelVersion?: string;
        };
        try {
          payload = JSON.parse(raw) as typeof payload;
        } catch {
          continue;
        }
        const delta = (payload.candidates?.[0]?.content?.parts ?? [])
          .map((part) => visibleGeminiText(part))
          .join('');
        if (delta) {
          text += delta;
          input.onToken(delta);
        }
        if (payload.modelVersion) modelVersion = payload.modelVersion;
        if (payload.usageMetadata) usageMetadata = payload.usageMetadata;
      }
    }
    text = text.trim();
    if (!text) throw new Error('Gemini Ask returned an empty reply');
    return {
      text,
      model: modelVersion || model,
      usage: geminiMeasuredUsage(usageMetadata, modelVersion || model),
    };
  }

  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: Record<string, unknown>;
    modelVersion?: string;
  };
  const text = extractGeminiText(payload);
  if (!text) throw new Error('Gemini Ask returned an empty reply');
  return {
    text,
    model: payload.modelVersion || model,
    usage: geminiMeasuredUsage(payload.usageMetadata ?? null, payload.modelVersion || model),
  };
}

/**
 * Complete an Ask turn. Returns null when no provider is configured or
 * every configured provider failed — callers then serve the grounded answer.
 *
 * Pass `onToken` to stream visible deltas as they arrive (Anthropic stream /
 * Gemini SSE). Interactive Ask prefers Anthropic when keyed; otherwise
 * Flash-Lite + thinking off. Pass `mode: 'analysis'` for heavier offline extractors.
 */
export async function completeAskText(input: CompleteAskTextInput): Promise<AskModelResult | null> {
  // Runaway guard: a clip whose background passes keep re-running (retry or
  // regeneration loops) stops calling paid models after a fixed number of calls
  // and falls back to the deterministic path the callers already have.
  if (!takeBackgroundCallSlot()) return null;
  const result = await completeAskTextUnmetered(input);
  // Background video work (summaries, speaker plans, safety checks) runs in a
  // metering scope: record this call there. Ask turns record their own total.
  if (result?.usage) {
    meterBackgroundUsage({
      source: input.meterSource ?? 'background_completion',
      modelId: result.model,
      usage: result.usage,
    });
  }
  return result;
}

type CompleteAskTextInput = Parameters<typeof completeAskTextUnmetered>[0];

/**
 * Max paid background model calls per clip inside a rolling window:
 * VIDEO_CALLS_BASE (30) + VIDEO_CALLS_PER_HOUR (25) x hours of footage.
 * A normal 1-2 min clip makes 5-11; the Oct 3-4 runs made 30-62.
 * VIDEO_MAX_MODEL_CALLS_PER_CLIP=0 turns the cap off; any other value is a flat override.
 */
export function videoMaxModelCallsPerClip(durationSeconds?: number | null): number {
  const flat = process.env.VIDEO_MAX_MODEL_CALLS_PER_CLIP;
  if (flat != null && flat.trim() !== '') {
    const n = Number(flat);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  const base = Number(process.env.VIDEO_CALLS_BASE ?? '30');
  const perHour = Number(process.env.VIDEO_CALLS_PER_HOUR ?? '25');
  const hours = Math.max(0, Number(durationSeconds) || 0) / 3600;
  return Math.ceil((Number.isFinite(base) ? base : 30) + (Number.isFinite(perHour) ? perHour : 25) * hours);
}

const CLIP_CALL_WINDOW_MS = 6 * 60 * 60 * 1000;
const clipCalls = new Map<string, number[]>();

/** Exposed for tests. */
export function resetBackgroundCallSlots(): void {
  clipCalls.clear();
}

/** True when this background call may run; Ask turns (no proof scope) always may. */
export function takeBackgroundCallSlot(now = Date.now()): boolean {
  const scope = currentAiUsageScope();
  const proofId = scope?.meterFeature ? scope.proofId : null;
  const cap = videoMaxModelCallsPerClip(scope?.durationSeconds ?? null);
  if (!proofId || cap === 0) return true;
  const recent = (clipCalls.get(proofId) ?? []).filter((t) => now - t < CLIP_CALL_WINDOW_MS);
  if (recent.length >= cap) {
    clipCalls.set(proofId, recent);
    console.warn('[video-cost] per-clip model call cap reached; using fallback', { proofId, cap });
    return false;
  }
  recent.push(now);
  clipCalls.set(proofId, recent);
  return true;
}

/**
 * Anthropic model for one background video stage, or undefined to keep
 * ANTHROPIC_MODEL. Each stage has its own env flag so a saving can be reverted
 * on its own: VIDEO_SUMMARY_MODEL (conversation summary), VIDEO_LIGHT_MODEL
 * (fusion, speaker roles, day film; see config.ts).
 */
export function videoStageAnthropicModel(envName: string): string | undefined {
  const v = (process.env[envName] ?? '').trim();
  return v || undefined;
}

async function completeAskTextUnmetered(input: {
  /** Ledger source when this runs inside a background metering scope. */
  meterSource?: string;
  system: string;
  user: string;
  /**
   * Stable prefix cached with the system prompt (Anthropic cache_control,
   * Gemini context cache when the prefix is long enough). The question stays
   * in `user`.
   */
  stable?: string | null;
  anthropicApiKey?: string | null;
  maxTokens?: number;
  fetchFn?: typeof fetch;
  mode?: AskCompletionMode;
  onToken?: (text: string) => void;
  signal?: AbortSignal;
  /**
   * When set, a reasoning turn uses this absolute deadline instead of starting
   * a new window. Research fallback passes the deadline captured when Ask began.
   */
  deadlineAt?: number;
  /** Overrides ANTHROPIC_MODEL for this call. Titles use the fast model. */
  anthropicModel?: string | null;
}): Promise<AskModelResult | null> {
  const mode = input.mode ?? 'interactive';
  const reasoning = mode === 'reasoning';
  const { anthropicMax, geminiMax } = resolveMaxTokens({ maxTokens: input.maxTokens, mode });
  const anthropicKey = (input.anthropicApiKey ?? anthropicAskApiKey()).trim();
  const freshDeadline = Date.now() + askReasoningTimeoutMs();
  const deadline = reasoning ? Math.min(input.deadlineAt ?? freshDeadline, freshDeadline) : 0;
  // Same floor as the lookup step: a turn that cannot finish is not started.
  if (reasoning && deadline - Date.now() < 1500) return null;
  const signalFor = (): AbortSignal | undefined => {
    if (!reasoning) return input.signal;
    const left = deadline - Date.now();
    if (left < 1500) throw new Error('ask_reasoning_timeout');
    return AbortSignal.timeout(left);
  };

  if (anthropicKey) {
    try {
      return await completeWithAnthropic({
        apiKey: anthropicKey,
        system: input.system,
        stable: input.stable,
        user: input.user,
        maxTokens: anthropicMax,
        onToken: input.onToken,
        reasoning,
        signal: signalFor(),
        model: input.anthropicModel ?? undefined,
      });
    } catch (err) {
      logAskFailure('ask_anthropic_failed', err);
    }
  }

  const googleKey = googleVisionApiKey();
  if (googleKey) {
    try {
      return await completeWithGemini({
        apiKey: googleKey,
        system: input.system,
        stable: input.stable,
        user: input.user,
        maxTokens: geminiMax,
        mode: reasoning ? 'analysis' : mode,
        fetchFn: input.fetchFn,
        onToken: input.onToken,
        signal: reasoning ? signalFor() : input.signal,
      });
    } catch (err) {
      logAskFailure('ask_gemini_failed', err);
    }
  }

  return null;
}
