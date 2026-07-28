/**
 * The provider-agnostic model interface.
 *
 * Everything above this file — routing, reward, learning — deals only in
 * `ModelProvider`. That boundary is the whole point: the learning loop treats a
 * model as an interchangeable *action*, so OpenAI, Anthropic, Google, xAI and a
 * self-hosted open-weights server are all just arms it can pull and compare.
 * Adding a vendor must never require touching the policy.
 *
 * Deliberately implemented on `fetch` rather than five vendor SDKs:
 *   - zero new dependencies, so a vendor's SDK release cadence cannot break us;
 *   - one uniform error/timeout/usage shape, which the reward function needs
 *     (a provider that reports no token usage would silently score as free);
 *   - a new OpenAI-compatible endpoint is a config entry, not a code change.
 */

export type ProviderId = 'openai' | 'anthropic' | 'google' | 'xai' | 'oss';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  /** Provider-native model identifier, e.g. `claude-sonnet-5`. */
  model: string;
  /** System prompt. Carried separately because vendors place it differently. */
  system?: string;
  messages: ChatMessage[];
  maxOutputTokens?: number;
  temperature?: number;
  /**
   * When set, the provider is asked to emit JSON only. We ask for JSON *mode*
   * rather than per-vendor structured-output schemas: schema support differs by
   * vendor and by model, and an arm that silently fails to honour a schema would
   * be punished by the reward function for the wrapper's shortcoming rather than
   * its own. Schema conformance is checked by our own verifier instead, so every
   * arm is judged on identical terms.
   */
  json?: boolean;
  /** Aborts the HTTP request; the executor always supplies one. */
  signal?: AbortSignal;
}

export interface CompletionResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** Provider-reported stop reason, normalised to lower case where available. */
  stopReason: string | null;
}

export interface ModelProvider {
  readonly id: ProviderId;
  /** Human-readable endpoint description, used in diagnostics. */
  readonly baseUrl: string;
  /** False when no API key is configured — such arms are excluded from routing. */
  isConfigured(): boolean;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

/**
 * A failure from a model call.
 *
 * `retryable` separates "this vendor is having a bad minute" from "this arm
 * produced a bad answer". Only the latter is evidence about the arm's quality,
 * so the executor fails over on retryable errors without recording a reward —
 * otherwise a vendor outage would teach the policy to abandon a good model.
 */
export class ProviderError extends Error {
  public readonly provider: ProviderId;
  public readonly status: number;
  public readonly retryable: boolean;

  constructor(provider: ProviderId, status: number, message: string, retryable: boolean) {
    super(`[${provider}] ${message}`);
    this.name = 'ProviderError';
    this.provider = provider;
    this.status = status;
    this.retryable = retryable;
  }
}

/** 408/409/429 and all 5xx are transient; 0 means the request never landed. */
export function isRetryableStatus(status: number): boolean {
  return status === 0 || status === 408 || status === 409 || status === 429 || status >= 500;
}
