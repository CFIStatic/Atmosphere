/**
 * Text completion for Ask (job file, clip, proof Q&A).
 *
 * Production often has a working Gemini key (clip readings already use it)
 * and no Anthropic key. Ask used to require Anthropic only, so the office
 * chat fell back to keyword matching and answered "The videos on file do
 * not show that" for ordinary questions.
 *
 * Order: organisation / server Anthropic key, then Gemini. Failures are
 * logged and the next provider is tried. Callers keep their grounded
 * keyword answer when nothing is configured or every provider fails.
 */
import {
  anthropicClientForKey,
  tryExtractUsage,
  type MeasuredUsage,
} from './anthropic.js';
import { googleVisionApiKey } from './visionProvider.js';
import { logger } from './logger.js';

export type AskProvider = 'anthropic' | 'google' | 'unconfigured';

export type AskModelResult = {
  text: string;
  model: string;
  usage: MeasuredUsage | null;
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
  return (process.env.ANTHROPIC_MODEL ?? process.env.ANTHROPIC_DEFAULT_MODEL ?? 'claude-opus-5').trim();
}

function geminiAskModel(): string {
  return (
    process.env.VERIFICATION_PRIMARY_MODEL ??
    process.env.GOOGLE_MODEL_FAST ??
    'gemini-3.6-flash'
  ).trim();
}

function geminiBaseUrl(): string {
  return (process.env.GOOGLE_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
}

function errorDetail(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ').slice(0, 280);
}

async function completeWithAnthropic(input: {
  apiKey: string;
  system: string;
  user: string;
  maxTokens: number;
}): Promise<AskModelResult> {
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

async function completeWithGemini(input: {
  apiKey: string;
  system: string;
  user: string;
  maxTokens: number;
  model?: string;
  fetchFn?: typeof fetch;
}): Promise<AskModelResult> {
  const model = input.model || geminiAskModel();
  const fetchFn = input.fetchFn ?? fetch;
  const url = `${geminiBaseUrl()}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': input.apiKey },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: input.system }] },
      contents: [{ role: 'user', parts: [{ text: input.user }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: input.maxTokens,
      },
    }),
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
  const text = (payload.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? '')
    .join('\n')
    .trim();
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
 */
export async function completeAskText(input: {
  system: string;
  user: string;
  anthropicApiKey?: string | null;
  maxTokens?: number;
  fetchFn?: typeof fetch;
}): Promise<AskModelResult | null> {
  const maxTokens = input.maxTokens ?? 500;
  const anthropicKey = (input.anthropicApiKey ?? anthropicAskApiKey()).trim();

  if (anthropicKey) {
    try {
      return await completeWithAnthropic({
        apiKey: anthropicKey,
        system: input.system,
        user: input.user,
        maxTokens,
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
        maxTokens,
        fetchFn: input.fetchFn,
      });
    } catch (err) {
      logger.warn('ask_gemini_failed', { detail: errorDetail(err) });
    }
  }

  return null;
}
