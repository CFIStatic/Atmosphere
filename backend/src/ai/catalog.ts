import { config } from '../config.js';
import type { ProviderId } from './providers/types.js';

/**
 * The model catalog: every model the platform may route to, with the metadata
 * the reward function needs to compare them on equal terms.
 *
 * ── On the prices ────────────────────────────────────────────────────────────
 * These are USD per **million** tokens and they are *estimates*. Vendor pricing
 * changes without notice, so treat this table as a maintained input, not a
 * source of truth — reconcile it against your invoices, and override any entry
 * with `AI_PRICE_OVERRIDES` (JSON) without a deploy.
 *
 * Being slightly stale is tolerable by design: cost enters the reward only as a
 * *relative* penalty between arms, so a uniform drift moves every arm together
 * and changes no decision. What would genuinely mislead the policy is a missing
 * entry, so an unknown model is priced pessimistically rather than free —
 * otherwise the router would learn to love whichever model we forgot to price.
 *
 * ── On the model ids ─────────────────────────────────────────────────────────
 * Vendors rename and retire model ids on their own schedule. Every id here is
 * overridable via env, and an arm whose id a vendor rejects fails closed: the
 * executor fails over to another arm and the error surfaces in diagnostics
 * rather than being scored as poor quality.
 */

export interface CatalogEntry {
  provider: ProviderId;
  /** Provider-native id sent on the wire. */
  model: string;
  /** Stable internal key; survives a vendor renaming the model. */
  key: string;
  inputPricePerMTok: number;
  outputPricePerMTok: number;
  /**
   * Rough capability tier. Used only as a *prior* for a brand-new arm, so the
   * policy starts somewhere sensible instead of uniformly ignorant. Evidence
   * overrides it quickly — this is not a hard-coded ranking.
   */
  tier: 'frontier' | 'balanced' | 'fast';
  contextWindow: number;
}

const DEFAULT_CATALOG: CatalogEntry[] = [
  // ── OpenAI ────────────────────────────────────────────────────────────────
  { key: 'openai:flagship', provider: 'openai', model: process.env.OPENAI_MODEL_FLAGSHIP ?? 'gpt-5', inputPricePerMTok: 1.25, outputPricePerMTok: 10, tier: 'frontier', contextWindow: 400_000 },
  { key: 'openai:mini', provider: 'openai', model: process.env.OPENAI_MODEL_MINI ?? 'gpt-5-mini', inputPricePerMTok: 0.25, outputPricePerMTok: 2, tier: 'fast', contextWindow: 400_000 },

  // ── Anthropic ─────────────────────────────────────────────────────────────
  { key: 'anthropic:flagship', provider: 'anthropic', model: process.env.ANTHROPIC_MODEL_FLAGSHIP ?? 'claude-opus-5', inputPricePerMTok: 15, outputPricePerMTok: 75, tier: 'frontier', contextWindow: 200_000 },
  { key: 'anthropic:balanced', provider: 'anthropic', model: process.env.ANTHROPIC_MODEL_BALANCED ?? 'claude-sonnet-5', inputPricePerMTok: 3, outputPricePerMTok: 15, tier: 'balanced', contextWindow: 200_000 },
  { key: 'anthropic:fast', provider: 'anthropic', model: process.env.ANTHROPIC_MODEL_FAST ?? 'claude-haiku-4-5-20251001', inputPricePerMTok: 1, outputPricePerMTok: 5, tier: 'fast', contextWindow: 200_000 },

  // ── Google ────────────────────────────────────────────────────────────────
  { key: 'google:flagship', provider: 'google', model: process.env.GOOGLE_MODEL_FLAGSHIP ?? 'gemini-2.5-pro', inputPricePerMTok: 1.25, outputPricePerMTok: 10, tier: 'frontier', contextWindow: 1_000_000 },
  { key: 'google:fast', provider: 'google', model: process.env.GOOGLE_MODEL_FAST ?? 'gemini-3.6-flash', inputPricePerMTok: 0.3, outputPricePerMTok: 2.5, tier: 'fast', contextWindow: 1_000_000 },

  // ── xAI (Grok) ────────────────────────────────────────────────────────────
  { key: 'xai:flagship', provider: 'xai', model: process.env.XAI_MODEL_FLAGSHIP ?? 'grok-4', inputPricePerMTok: 3, outputPricePerMTok: 15, tier: 'frontier', contextWindow: 256_000 },

  // ── Open weights ──────────────────────────────────────────────────────────
  // Self-hosted, so "price" is amortised GPU cost per token rather than a
  // vendor invoice. Set OSS_PRICE_* from your own utilisation numbers; the
  // default assumes a busy shared endpoint. This is the arm that a fine-tune
  // trained on our own exported preference pairs would replace.
  {
    key: 'oss:primary',
    provider: 'oss',
    model: config.ai.oss.model,
    inputPricePerMTok: Number(process.env.OSS_PRICE_INPUT_PER_MTOK ?? 0.1),
    outputPricePerMTok: Number(process.env.OSS_PRICE_OUTPUT_PER_MTOK ?? 0.3),
    tier: 'balanced',
    contextWindow: 128_000,
  },
];

/** Applied last so an operator can correct a price without a deploy. */
function applyPriceOverrides(entries: CatalogEntry[]): CatalogEntry[] {
  const raw = process.env.AI_PRICE_OVERRIDES;
  if (!raw) return entries;
  try {
    const overrides = JSON.parse(raw) as Record<string, { input?: number; output?: number }>;
    return entries.map((entry) => {
      const override = overrides[entry.key] ?? overrides[entry.model];
      if (!override) return entry;
      return {
        ...entry,
        inputPricePerMTok: override.input ?? entry.inputPricePerMTok,
        outputPricePerMTok: override.output ?? entry.outputPricePerMTok,
      };
    });
  } catch {
    // A malformed override must not take the server down — the catalog still
    // works, just at listed prices. The warning is the operator's signal.
    console.warn('[ai] AI_PRICE_OVERRIDES is not valid JSON; using listed prices');
    return entries;
  }
}

export const catalog: CatalogEntry[] = applyPriceOverrides(DEFAULT_CATALOG);

const byModel = new Map(catalog.map((entry) => [`${entry.provider}:${entry.model}`, entry]));

export function lookupModel(provider: ProviderId, model: string): CatalogEntry | undefined {
  return byModel.get(`${provider}:${model}`);
}

/**
 * Cost of one call in USD.
 *
 * An unpriced model is charged at the most expensive rate in the catalog. That
 * asymmetry is intentional: under-pricing an arm makes the policy prefer it for
 * a reason that is not real, which is the one failure mode here that quietly
 * corrupts learning instead of just adding noise.
 */
export function estimateCostUsd(
  provider: ProviderId,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const entry = lookupModel(provider, model);
  const inputPrice = entry?.inputPricePerMTok ?? maxPrice('inputPricePerMTok');
  const outputPrice = entry?.outputPricePerMTok ?? maxPrice('outputPricePerMTok');
  return (inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000;
}

function maxPrice(field: 'inputPricePerMTok' | 'outputPricePerMTok'): number {
  return catalog.reduce((max, entry) => Math.max(max, entry[field]), 0);
}

/** Optimistic prior for a new arm, by tier — see CatalogEntry.tier. */
export function tierPrior(tier: CatalogEntry['tier']): { alpha: number; beta: number } {
  // Weak pseudo-counts (they sum to 4) so ~30 real trials dominate them.
  switch (tier) {
    case 'frontier':
      return { alpha: 2.6, beta: 1.4 };
    case 'balanced':
      return { alpha: 2.2, beta: 1.8 };
    default:
      return { alpha: 2.0, beta: 2.0 };
  }
}
