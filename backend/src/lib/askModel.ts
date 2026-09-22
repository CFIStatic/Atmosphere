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
import {
  anthropicClientForKey,
  tryExtractUsage,
  type MeasuredUsage,
} from './anthropic.js';
import { googleVisionApiKey } from './visionProvider.js';
import { logger } from './logger.js';
import { resolveAnthropicModel } from './anthropicModel.js';

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

export type AskCompletionMode = 'interactive' | 'analysis';

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

/** Low-latency interactive Ask model (override with ASK_MODEL / ASK_FAST_MODEL). */
export function geminiAskModel(mode: AskCompletionMode = 'interactive'): string {
  if (mode === 'analysis') {
    return (
      process.env.ASK_ANALYSIS_MODEL ??
      process.env.VERIFICATION_PRIMARY_MODEL ??
      'gemini-2.5-pro'
    ).trim();
  }
  return (
    process.env.ASK_MODEL ??
    process.env.ASK_FAST_MODEL ??
    process.env.GOOGLE_MODEL_FAST ??
    'gemini-2.5-flash-lite'
  ).trim();
}

function geminiThinkingLevel(mode: AskCompletionMode): string {
  const fromEnv =
    mode === 'analysis'
      ? (process.env.ASK_ANALYSIS_THINKING_LEVEL ?? '').trim()
      : (process.env.ASK_THINKING_LEVEL ?? '').trim();
  if (fromEnv) return fromEnv;
  return mode === 'analysis' ? GEMINI_ASK_ANALYSIS_THINKING_LEVEL : GEMINI_ASK_THINKING_LEVEL;
}

function geminiBaseUrl(): string {
  return (process.env.GOOGLE_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
}

function errorDetail(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ').slice(0, 280);
}

function resolveMaxTokens(input: { maxTokens?: number; mode?: AskCompletionMode }): {
  anthropicMax: number;
  geminiMax: number;
} {
  const mode = input.mode ?? 'interactive';
  const fallback = mode === 'analysis' ? GEMINI_ASK_ANALYSIS_MAX_TOKENS : ANTHROPIC_ASK_MAX_TOKENS;
  const anthropicMax = input.maxTokens ?? fallback;
  const geminiFloor = mode === 'analysis' ? GEMINI_ASK_ANALYSIS_MAX_TOKENS : GEMINI_ASK_MAX_TOKENS;
  // Honour an explicit higher maxTokens (e.g. conversation brief) without
  // forcing the old 20k interactive ceiling onto every call.
  const geminiMax = Math.max(anthropicMax, input.maxTokens != null ? anthropicMax : geminiFloor);
  return { anthropicMax, geminiMax };
}

function buildGeminiGenerationConfig(input: {
  model: string;
  maxTokens: number;
  mode: AskCompletionMode;
}): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = {
    temperature: 0,
    maxOutputTokens: input.maxTokens,
  };
  const level = geminiThinkingLevel(input.mode);
  // Flash-Lite / non-thinking ids reject thinkingConfig; only attach when useful.
  if (/^gemini-3/i.test(input.model)) {
    if (level === 'none' || level === 'off') {
      // omit thinkingConfig
    } else {
      generationConfig.thinkingConfig = { thinkingLevel: level };
    }
  } else if (/^gemini-2\.5/i.test(input.model) && !/lite/i.test(input.model)) {
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

async function completeWithAnthropic(input: {
  apiKey: string;
  system: string;
  user: string;
  maxTokens: number;
  onToken?: (text: string) => void;
}): Promise<AskModelResult> {
  if (input.onToken) {
    const stream = anthropicClientForKey(input.apiKey).messages.stream({
      model: anthropicAskModel(),
      max_tokens: input.maxTokens,
      system: input.system,
      messages: [{ role: 'user', content: input.user }],
    });
    let text = '';
    stream.on('text', (delta: string) => {
      if (!delta) return;
      text += delta;
      input.onToken?.(delta);
    });
    const response = await stream.finalMessage();
    text = text.trim() ||
      response.content
        .filter((block: { type: string }) => block.type === 'text')
        .map((block: { type: string; text?: string }) => block.text ?? '')
        .join('\n')
        .trim();
    if (!text) throw new Error('Anthropic Ask returned an empty reply');
    return { text, model: response.model, usage: tryExtractUsage(response.usage) };
  }

  const response = await anthropicClientForKey(input.apiKey).messages.create({
    model: anthropicAskModel(),
    max_tokens: input.maxTokens,
    system: input.system,
    messages: [{ role: 'user', content: input.user }],
  });
  const text = response.content
    .filter((block: { type: string }) => block.type === 'text')
    .map((block: { type: string; text?: string }) => block.text ?? '')
    .join('\n')
    .trim();
  if (!text) throw new Error('Anthropic Ask returned an empty reply');
  return { text, model: response.model, usage: tryExtractUsage(response.usage) };
}

function extractGeminiText(payload: {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}): string {
  return (payload.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? '')
    .join('')
    .trim();
}

async function completeWithGemini(input: {
  apiKey: string;
  system: string;
  user: string;
  maxTokens: number;
  mode: AskCompletionMode;
  model?: string;
  fetchFn?: typeof fetch;
  onToken?: (text: string) => void;
}): Promise<AskModelResult> {
  const model = input.model || geminiAskModel(input.mode);
  const fetchFn = input.fetchFn ?? fetch;
  const generationConfig = buildGeminiGenerationConfig({
    model,
    maxTokens: input.maxTokens,
    mode: input.mode,
  });
  const body = JSON.stringify({
    system_instruction: { parts: [{ text: input.system }] },
    contents: [{ role: 'user', parts: [{ text: input.user }] }],
    generationConfig,
  });

  if (input.onToken) {
    const url = `${geminiBaseUrl()}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
    const response = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': input.apiKey },
      body,
    });
    if (!response.ok) {
      const errText = await response.text();
      const suggested = errText.match(/use models\/([a-z0-9._-]+)/i)?.[1];
      if (response.status === 404 && suggested && suggested !== model && !input.model) {
        logger.warn('ask_gemini_model_retired', { model, suggested });
        return completeWithGemini({ ...input, model: suggested });
      }
      throw new Error(`Gemini Ask error ${response.status}: ${errText.slice(0, 400)}`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Gemini Ask stream returned no body');
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let modelVersion = model;
    let inputTokens = 0;
    let outputTokens = 0;
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
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
          modelVersion?: string;
        };
        try {
          payload = JSON.parse(raw) as typeof payload;
        } catch {
          continue;
        }
        const delta = (payload.candidates?.[0]?.content?.parts ?? [])
          .map((part) => part.text ?? '')
          .join('');
        if (delta) {
          text += delta;
          input.onToken(delta);
        }
        if (payload.modelVersion) modelVersion = payload.modelVersion;
        if (payload.usageMetadata?.promptTokenCount != null) {
          inputTokens = payload.usageMetadata.promptTokenCount;
        }
        if (payload.usageMetadata?.candidatesTokenCount != null) {
          outputTokens = payload.usageMetadata.candidatesTokenCount;
        }
      }
    }
    text = text.trim();
    if (!text) throw new Error('Gemini Ask returned an empty reply');
    return {
      text,
      model: modelVersion || model,
      usage: {
        inputTokens,
        outputTokens,
        cacheWrite5mTokens: 0,
        cacheWrite1hTokens: 0,
        cacheReadTokens: 0,
        totalTokens: inputTokens + outputTokens,
      },
    };
  }

  const url = `${geminiBaseUrl()}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': input.apiKey },
    body,
  });
  if (!response.ok) {
    const errText = await response.text();
    const suggested = errText.match(/use models\/([a-z0-9._-]+)/i)?.[1];
    if (response.status === 404 && suggested && suggested !== model && !input.model) {
      logger.warn('ask_gemini_model_retired', { model, suggested });
      return completeWithGemini({ ...input, model: suggested });
    }
    throw new Error(`Gemini Ask error ${response.status}: ${errText.slice(0, 400)}`);
  }
  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    modelVersion?: string;
  };
  const text = extractGeminiText(payload);
  if (!text) throw new Error('Gemini Ask returned an empty reply');
  const inputTokens = payload.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = payload.usageMetadata?.candidatesTokenCount ?? 0;
  return {
    text,
    model: payload.modelVersion || model,
    usage: {
      inputTokens,
      outputTokens,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      cacheReadTokens: 0,
      totalTokens: inputTokens + outputTokens,
    },
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
export async function completeAskText(input: {
  system: string;
  user: string;
  anthropicApiKey?: string | null;
  maxTokens?: number;
  fetchFn?: typeof fetch;
  mode?: AskCompletionMode;
  onToken?: (text: string) => void;
}): Promise<AskModelResult | null> {
  const mode = input.mode ?? 'interactive';
  const { anthropicMax, geminiMax } = resolveMaxTokens({ maxTokens: input.maxTokens, mode });
  const anthropicKey = (input.anthropicApiKey ?? anthropicAskApiKey()).trim();

  if (anthropicKey) {
    try {
      return await completeWithAnthropic({
        apiKey: anthropicKey,
        system: input.system,
        user: input.user,
        maxTokens: anthropicMax,
        onToken: input.onToken,
      });
    } catch (err) {
      logger.warn('ask_anthropic_failed', { detail: errorDetail(err) });
    }
  }

  const googleKey = googleVisionApiKey();
  if (googleKey) {
    try {
      return await completeWithGemini({
        apiKey: googleKey,
        system: input.system,
        user: input.user,
        maxTokens: geminiMax,
        mode,
        fetchFn: input.fetchFn,
        onToken: input.onToken,
      });
    } catch (err) {
      logger.warn('ask_gemini_failed', { detail: errorDetail(err) });
    }
  }

  return null;
}
