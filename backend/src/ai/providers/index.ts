import { config } from '../../config.js';
import { AnthropicProvider } from './anthropic.js';
import { GoogleProvider } from './google.js';
import { OpenAICompatibleProvider } from './openaiCompatible.js';
import { ProviderError, type ModelProvider, type ProviderId } from './types.js';

/**
 * The provider registry — one instance per vendor, built once at boot.
 *
 * Providers with no credentials are still registered but report
 * `isConfigured() === false`. The router filters on that, so an operator turns a
 * whole family of arms on or off by adding or removing one environment
 * variable, with no code or database change. Running with only one key set is a
 * supported configuration: the loop degrades to learning over prompt variants
 * instead of over models.
 */
const providers: Record<ProviderId, ModelProvider> = {
  openai: new OpenAICompatibleProvider('openai', config.ai.openai.baseUrl, config.ai.openai.apiKey),
  anthropic: new AnthropicProvider(config.ai.anthropic.baseUrl, config.ai.anthropic.apiKey),
  google: new GoogleProvider(config.ai.google.baseUrl, config.ai.google.apiKey),
  // Grok speaks the OpenAI dialect, so it needs no adapter of its own.
  xai: new OpenAICompatibleProvider('xai', config.ai.xai.baseUrl, config.ai.xai.apiKey),
  // Any OpenAI-compatible open-weights server: vLLM, Ollama, Together,
  // Fireworks, OpenRouter, or a fine-tune of our own (see docs — the export
  // produced by the learning loop is meant to be trained into exactly this arm).
  oss: new OpenAICompatibleProvider('oss', config.ai.oss.baseUrl, config.ai.oss.apiKey),
};

export function getProvider(id: ProviderId): ModelProvider {
  const provider = providers[id];
  if (!provider) throw new ProviderError(id, 500, `Unknown provider: ${id}`, false);
  return provider;
}

export function isProviderConfigured(id: ProviderId): boolean {
  return providers[id]?.isConfigured() ?? false;
}

/** Provider ids with credentials present — used by the router and diagnostics. */
export function configuredProviders(): ProviderId[] {
  return (Object.keys(providers) as ProviderId[]).filter((id) => providers[id].isConfigured());
}

export * from './types.js';
