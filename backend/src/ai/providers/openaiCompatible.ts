import {
  isRetryableStatus,
  ProviderError,
  type ChatMessage,
  type CompletionRequest,
  type CompletionResult,
  type ModelProvider,
  type ProviderId,
} from './types.js';

/**
 * Adapter for every endpoint that speaks the OpenAI `/chat/completions` dialect.
 *
 * That is three of our five providers — OpenAI itself, xAI's Grok, and any
 * open-weights server (vLLM, Ollama, Together, Fireworks, OpenRouter) — because
 * the dialect became the de-facto standard. One implementation parameterised by
 * base URL and key keeps them behaviourally identical, which matters: if the
 * open-source arm were wired differently from the OpenAI arm, a reward gap
 * between them would be ambiguous evidence about the *models*.
 */
export class OpenAICompatibleProvider implements ModelProvider {
  public readonly id: ProviderId;
  public readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(id: ProviderId, baseUrl: string, apiKey: string) {
    this.id = id;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
  }

  isConfigured(): boolean {
    // A local open-weights server usually needs no key, so a base URL is enough
    // for `oss`. Hosted vendors always require one.
    return this.id === 'oss' ? Boolean(this.baseUrl) : Boolean(this.apiKey && this.baseUrl);
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const messages: Array<{ role: string; content: string }> = [];
    if (request.system) messages.push({ role: 'system', content: request.system });
    for (const m of request.messages) messages.push({ role: m.role, content: m.content });

    const body: Record<string, unknown> = {
      model: request.model,
      messages,
      max_completion_tokens: request.maxOutputTokens,
    };
    // Reasoning models reject any temperature other than the default, so only
    // send it when the caller actually asked for one.
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.json) body.response_format = { type: 'json_object' };

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: request.signal,
    }).catch((err: unknown) => {
      throw new ProviderError(this.id, 0, describeNetworkError(err), true);
    });

    if (!response.ok) {
      throw new ProviderError(
        this.id,
        response.status,
        await readErrorMessage(response),
        isRetryableStatus(response.status),
      );
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const choice = payload.choices?.[0];
    const text = choice?.message?.content ?? '';
    if (!text) {
      // An empty body is not a quality signal about the model — it is a broken
      // response — so surface it as retryable rather than scoring it as a miss.
      throw new ProviderError(this.id, response.status, 'Empty completion', true);
    }

    return {
      text,
      inputTokens: payload.usage?.prompt_tokens ?? 0,
      outputTokens: payload.usage?.completion_tokens ?? 0,
      stopReason: choice?.finish_reason ?? null,
    };
  }
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Shared by all adapters: a short, safe description of a transport failure. */
export function describeNetworkError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') return 'Request timed out';
    return err.message;
  }
  return 'Network error';
}

/**
 * Vendors describe errors in incompatible envelopes. Pull out a message when we
 * can and always truncate: these strings can echo back prompt content, and they
 * end up in logs.
 */
export async function readErrorMessage(response: Response): Promise<string> {
  try {
    const text = await response.text();
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
      const message =
        typeof parsed.error === 'string'
          ? parsed.error
          : (parsed.error?.message ?? parsed.message ?? text);
      return truncate(message, 300);
    } catch {
      return truncate(text, 300);
    }
  } catch {
    return `HTTP ${response.status}`;
  }
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

/** Re-exported so adapters share one message shape. */
export type { ChatMessage };
