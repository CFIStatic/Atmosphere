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
 * Google Gemini (Generative Language API) adapter.
 *
 * Gemini's envelope differs most from the others: messages are `contents` with
 * `parts`, the assistant role is called `model`, the system prompt is
 * `system_instruction`, and generation settings live under `generationConfig`.
 * All of that is translated here.
 */
export class GoogleProvider implements ModelProvider {
  public readonly id: ProviderId = 'google';
  public readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.baseUrl);
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: request.maxOutputTokens,
    };
    if (request.temperature !== undefined) generationConfig.temperature = request.temperature;
    if (request.json) generationConfig.responseMimeType = 'application/json';

    const body: Record<string, unknown> = {
      contents: request.messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      generationConfig,
    };
    if (request.system) {
      body.system_instruction = { parts: [{ text: request.system }] };
    }

    // The key goes in a header rather than the query string so it cannot leak
    // through proxy access logs or error messages that echo the URL.
    const url = `${this.baseUrl}/v1beta/models/${encodeURIComponent(request.model)}:generateContent`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
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

    const payload = (await response.json()) as GenerateContentResponse;
    const candidate = payload.candidates?.[0];
    const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? '').join('');

    if (!text) {
      // A safety block returns 200 with no text. That is a refusal, not a
      // transport fault, so it must reach the reward function as a real (bad)
      // outcome for this arm rather than being retried away.
      const blocked = candidate?.finishReason === 'SAFETY' || payload.promptFeedback?.blockReason;
      throw new ProviderError(
        this.id,
        response.status,
        blocked ? 'Blocked by safety filter' : 'Empty completion',
        !blocked,
      );
    }

    return {
      text,
      inputTokens: payload.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: payload.usageMetadata?.candidatesTokenCount ?? 0,
      stopReason: candidate?.finishReason?.toLowerCase() ?? null,
    };
  }
}

interface GenerateContentResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  promptFeedback?: { blockReason?: string };
}
