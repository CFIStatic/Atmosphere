/**
 * Cost-aware model router for video analysis.
 *
 * High-volume work (frame observations, bulk LLM verify) prefers the cheapest
 * configured vision-capable arm. Escalation / disputes / safety use a stronger
 * tier. Accuracy is protected by escalating when confidence is low — not by
 * running frontier models on every frame.
 *
 * Provider keys are read from env at selection time so adding a key does not
 * require a code change. Pricing comes from the shared AI catalog.
 */

import { catalog, lookupModel, type CatalogEntry } from '../../ai/catalog.js';
import type { ProviderId } from '../../ai/providers/types.js';
import { verificationConfig } from '../config.js';

export type VideoProviderId = Extract<ProviderId, 'openai' | 'anthropic' | 'google' | 'xai'>;

/** Work the video pipeline asks a model to do. */
export type VideoRouteTask =
  | 'frame_observation'
  | 'frame_escalation'
  | 'llm_verify'
  | 'llm_escalate'
  | 'proof_narration';

export interface VideoRouteChoice {
  provider: VideoProviderId;
  model: string;
  catalogKey: string;
  tier: CatalogEntry['tier'];
  inputPricePerMTok: number;
  outputPricePerMTok: number;
  reason: string;
}

export interface VideoRoutingPlan {
  frameObservation: VideoRouteChoice | null;
  frameEscalation: VideoRouteChoice | null;
  llmVerify: VideoRouteChoice | null;
  llmEscalate: VideoRouteChoice | null;
  proofNarration: VideoRouteChoice | null;
  configuredProviders: VideoProviderId[];
}

const VIDEO_PROVIDERS: VideoProviderId[] = ['google', 'openai', 'xai', 'anthropic'];

/** Preferred catalog keys per task, cheapest-first within the task's quality band. */
const TASK_PREFERENCES: Record<VideoRouteTask, string[]> = {
  // Bulk frames — cheapest vision first.
  frame_observation: [
    'google:verification-fast',
    'google:fast',
    'openai:mini',
    'xai:fast',
    'anthropic:fast',
  ],
  // Low-confidence / safety — mid tier before frontier spend.
  frame_escalation: [
    'anthropic:balanced',
    'openai:flagship',
    'google:flagship',
    'xai:flagship',
    'anthropic:flagship',
  ],
  // Work-event verify — cheap JSON reasoning; Sonnet only if nothing cheaper.
  llm_verify: [
    'google:verification-fast',
    'google:fast',
    'openai:mini',
    'xai:fast',
    'anthropic:fast',
    'anthropic:balanced',
  ],
  // Disputed / high-risk verify — accuracy over pennies.
  llm_escalate: [
    'anthropic:balanced',
    'openai:flagship',
    'google:flagship',
    'xai:flagship',
    'anthropic:flagship',
  ],
  // Day narration / before-after — needs decent vision; avoid frontier by default.
  proof_narration: [
    'anthropic:balanced',
    'google:fast',
    'openai:mini',
    'xai:fast',
    'anthropic:fast',
    'openai:flagship',
  ],
};

export function videoProviderApiKey(provider: VideoProviderId): string {
  switch (provider) {
    case 'google':
      return process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
    case 'anthropic':
      return process.env.ANTHROPIC_API_KEY || '';
    case 'openai':
      return process.env.OPENAI_API_KEY || '';
    case 'xai':
      return process.env.XAI_API_KEY || '';
  }
}

export function videoProviderBaseUrl(provider: VideoProviderId): string {
  switch (provider) {
    case 'google':
      return (process.env.GOOGLE_BASE_URL || 'https://generativelanguage.googleapis.com').replace(
        /\/+$/,
        '',
      );
    case 'anthropic':
      return (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
    case 'openai':
      return (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    case 'xai':
      return (process.env.XAI_BASE_URL || 'https://api.x.ai/v1').replace(/\/+$/, '');
  }
}

export function isVideoProviderConfigured(provider: VideoProviderId): boolean {
  return Boolean(videoProviderApiKey(provider));
}

export function configuredVideoProviders(): VideoProviderId[] {
  return VIDEO_PROVIDERS.filter(isVideoProviderConfigured);
}

function entryByKey(key: string): CatalogEntry | undefined {
  return catalog.find((e) => e.key === key);
}

function toChoice(entry: CatalogEntry, reason: string): VideoRouteChoice {
  return {
    provider: entry.provider as VideoProviderId,
    model: entry.model,
    catalogKey: entry.key,
    tier: entry.tier,
    inputPricePerMTok: entry.inputPricePerMTok,
    outputPricePerMTok: entry.outputPricePerMTok,
    reason,
  };
}

/**
 * Pick the cheapest configured arm from the preference list for this task.
 * Falls back to any configured catalog entry for that provider sorted by price
 * when preference keys are all missing/unconfigured.
 */
export function selectVideoRoute(task: VideoRouteTask): VideoRouteChoice | null {
  // Explicit env overrides for primary / escalation keep ops control without
  // abandoning automatic cheap routing for the other tasks.
  if (task === 'frame_observation') {
    const forced = forcedPrimaryVision();
    if (forced) return forced;
  }
  if (task === 'frame_escalation' || task === 'llm_escalate') {
    const forced = forcedEscalation();
    if (forced && isVideoProviderConfigured(forced.provider)) return forced;
  }
  if (task === 'llm_verify') {
    const forcedModel = process.env.VERIFICATION_LLM_VERIFIER_MODEL;
    if (forcedModel) {
      const byModel = catalog.find(
        (e) => e.model === forcedModel && isVideoProviderConfigured(e.provider as VideoProviderId),
      );
      if (byModel) {
        return toChoice(byModel, `VERIFICATION_LLM_VERIFIER_MODEL=${forcedModel}`);
      }
    }
  }

  for (const key of TASK_PREFERENCES[task]) {
    const entry = entryByKey(key);
    if (!entry) continue;
    if (!isVideoProviderConfigured(entry.provider as VideoProviderId)) continue;
    return toChoice(
      entry,
      `cheapest configured for ${task} (prefers ${key}, $${entry.inputPricePerMTok}/MTok in)`,
    );
  }

  // Last resort: cheapest configured catalog arm overall.
  const fallback = catalog
    .filter((e) => VIDEO_PROVIDERS.includes(e.provider as VideoProviderId))
    .filter((e) => isVideoProviderConfigured(e.provider as VideoProviderId))
    .sort(
      (a, b) =>
        a.inputPricePerMTok + a.outputPricePerMTok - (b.inputPricePerMTok + b.outputPricePerMTok),
    )[0];
  if (!fallback) return null;
  return toChoice(fallback, `fallback cheapest configured arm for ${task}`);
}

function forcedPrimaryVision(): VideoRouteChoice | null {
  const provider = (process.env.VERIFICATION_PRIMARY_PROVIDER || '').toLowerCase();
  const model = process.env.VERIFICATION_PRIMARY_MODEL;
  if (!provider || !model) return null;
  if (!VIDEO_PROVIDERS.includes(provider as VideoProviderId)) return null;
  if (!isVideoProviderConfigured(provider as VideoProviderId)) return null;
  const entry =
    lookupModel(provider as ProviderId, model) ??
    ({
      key: `${provider}:custom-primary`,
      provider: provider as ProviderId,
      model,
      inputPricePerMTok: 1,
      outputPricePerMTok: 5,
      tier: 'fast' as const,
      contextWindow: 128_000,
    } satisfies CatalogEntry);
  return toChoice(entry, `VERIFICATION_PRIMARY_* override (${provider}/${model})`);
}

function forcedEscalation(): VideoRouteChoice | null {
  const provider = (process.env.VERIFICATION_ESCALATION_PROVIDER || 'anthropic').toLowerCase();
  const model = process.env.VERIFICATION_ESCALATION_MODEL || verificationConfig.escalationModel;
  if (!VIDEO_PROVIDERS.includes(provider as VideoProviderId)) return null;
  const entry =
    lookupModel(provider as ProviderId, model) ??
    ({
      key: `${provider}:custom-escalation`,
      provider: provider as ProviderId,
      model,
      inputPricePerMTok: 3,
      outputPricePerMTok: 15,
      tier: 'balanced' as const,
      contextWindow: 200_000,
    } satisfies CatalogEntry);
  return toChoice(entry, `VERIFICATION_ESCALATION_* (${provider}/${model})`);
}

export function getVideoRoutingPlan(): VideoRoutingPlan {
  return {
    frameObservation: selectVideoRoute('frame_observation'),
    frameEscalation: selectVideoRoute('frame_escalation'),
    llmVerify: selectVideoRoute('llm_verify'),
    llmEscalate: selectVideoRoute('llm_escalate'),
    proofNarration: selectVideoRoute('proof_narration'),
    configuredProviders: configuredVideoProviders(),
  };
}

/** True when at least one provider can run real (non-mock) video AI. */
export function hasAnyVideoProvider(): boolean {
  return configuredVideoProviders().length > 0;
}
