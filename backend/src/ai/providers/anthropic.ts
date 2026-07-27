import { describeNetworkError, readErrorMessage } from './openaiCompatible.js';
import {
  isRetryableStatus,
  ProviderError,
  type CompletionRequest,
  type CompletionResult,
  type ModelProvider,
  type ProviderId,
} from './types.js';

/**
 * Anthropic Messages API adapter.
 *
 * Two shape differences from the OpenAI dialect are handled here so the rest of
 * the system never sees them: the system prompt is a top-level field rather than
 * a message, and `max_tokens` is required rather than optional.
 */
export class AnthropicProvider implements ModelProvider {
  public readonly id: ProviderId = 'anthropic';
  public readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly version: string;

  constructor(baseUrl: string, apiKey: string, version = '2023-06-01') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.version = version;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.baseUrl);
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    // Anthropic has no JSON mode; the accepted technique is to prefill the
    // assistant turn with `{` so the model can only continue as JSON. We strip
    // nothing on the way out except re-attaching that brace below.
    const prefill = request.json;

    const body: Record<string, unknown> = {
      model: request.model,
      // Required by the API — there is no "unbounded" option.
      max_tokens: request.maxOutputTokens ?? 2048,
      system: request.system,
      messages: [
        ...request.messages.map((m) => ({ role: m.role, content: m.content })),
        ...(prefill ? [{ role: 'assistant' as const, content: '{' }] : []),
      ],
    };
    if (request.temperature !== undefined) body.temperature = request.temperature;

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': this.version,
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

    const payload = (await response.json()) as MessagesResponse;
    const text = (payload.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('');

    if (!text) throw new ProviderError(this.id, response.status, 'Empty completion', true);

    return {
      // Put back the brace we prefilled, so callers get parseable JSON.
      text: prefill ? `{${text}` : text,
      inputTokens: payload.usage?.input_tokens ?? 0,
      outputTokens: payload.usage?.output_tokens ?? 0,
      stopReason: payload.stop_reason ?? null,
    };
  }
}

interface MessagesResponse {
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  stop_reason?: string;
}
