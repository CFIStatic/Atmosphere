import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { HttpError } from './errors.js';

/**
 * Token measurement.
 *
 * This is the part of the system that decides how much a customer is charged,
 * so it takes its numbers from exactly one place: the `usage` object on the
 * provider's own response. Not an estimate, not a character count, not a
 * tokenizer library, and never a figure supplied by the client.
 *
 * Two properties of the provider's usage object matter here:
 *
 *  1. The four token classes are DISJOINT. `input_tokens` counts only the
 *     uncached input; tokens served from cache appear in
 *     `cache_read_input_tokens` and tokens written to cache in
 *     `cache_creation_input_tokens`. Summing them is therefore correct and
 *     double-counts nothing — but dropping one silently under-bills.
 *
 *  2. Cache writes are priced by TTL (5-minute writes cost 1.25x the input
 *     rate, 1-hour writes 2x), so the aggregate has to be split. The detailed
 *     `cache_creation` breakdown is only present on some responses; when it is
 *     missing the whole amount is attributed to the 5-minute tier, which is the
 *     default TTL.
 */

export interface MeasuredUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  cacheReadTokens: number;
  /** Total across every class — for logging and reconciliation only. */
  totalTokens: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

function nonNegativeInt(value: unknown, field: string): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new HttpError(502, `Provider reported an invalid ${field}`, 'invalid_usage');
  }
  return Math.round(n);
}

/**
 * Normalise a provider `usage` object into the five counts we price on.
 *
 * Throws rather than guessing if the payload is unusable — billing a customer
 * from a usage object we could not parse is worse than failing the request.
 */
export function extractUsage(usage: any): MeasuredUsage {
  if (!usage || typeof usage !== 'object') {
    throw new HttpError(502, 'Provider response carried no usage data', 'missing_usage');
  }

  const inputTokens = nonNegativeInt(usage.input_tokens, 'input token count');
  const outputTokens = nonNegativeInt(usage.output_tokens, 'output token count');
  const cacheReadTokens = nonNegativeInt(usage.cache_read_input_tokens, 'cache read token count');
  const cacheCreationTotal = nonNegativeInt(
    usage.cache_creation_input_tokens,
    'cache creation token count',
  );

  // Split the cache writes by TTL when the provider reports the detail.
  const detail = usage.cache_creation;
  let cacheWrite5mTokens = 0;
  let cacheWrite1hTokens = 0;

  if (detail && typeof detail === 'object') {
    cacheWrite5mTokens = nonNegativeInt(detail.ephemeral_5m_input_tokens, '5m cache write count');
    cacheWrite1hTokens = nonNegativeInt(detail.ephemeral_1h_input_tokens, '1h cache write count');

    // If the detailed split does not reconcile with the aggregate, trust the
    // aggregate — under-billing from a partial breakdown is the failure mode
    // we care about. Any shortfall is attributed to the cheaper 5-minute tier
    // so we never over-charge on an ambiguous payload.
    const split = cacheWrite5mTokens + cacheWrite1hTokens;
    if (split !== cacheCreationTotal) {
      console.warn(
        `[usage] cache_creation split ${split} != aggregate ${cacheCreationTotal}; reconciling to aggregate`,
      );
      if (split < cacheCreationTotal) {
        cacheWrite5mTokens += cacheCreationTotal - split;
      } else {
        cacheWrite5mTokens = Math.max(0, cacheCreationTotal - cacheWrite1hTokens);
        cacheWrite1hTokens = Math.min(cacheWrite1hTokens, cacheCreationTotal);
      }
    }
  } else {
    // No breakdown: the default TTL is 5 minutes.
    cacheWrite5mTokens = cacheCreationTotal;
  }

  return {
    inputTokens,
    outputTokens,
    cacheWrite5mTokens,
    cacheWrite1hTokens,
    cacheReadTokens,
    totalTokens:
      inputTokens + outputTokens + cacheWrite5mTokens + cacheWrite1hTokens + cacheReadTokens,
  };
}

const EMPTY_USAGE: MeasuredUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0,
  cacheReadTokens: 0,
  totalTokens: 0,
};

/**
 * Best-effort parse for paths that must still answer even when the provider
 * omitted usage. Returns zeros rather than failing the conversation.
 */
export function tryExtractUsage(usage: unknown): MeasuredUsage {
  try {
    return extractUsage(usage);
  } catch {
    return EMPTY_USAGE;
  }
}

export function cacheTokensOf(usage: MeasuredUsage): number {
  return usage.cacheWrite5mTokens + usage.cacheWrite1hTokens + usage.cacheReadTokens;
}

/**
 * A response can bill for more than one attempt when server-side refusal
 * fallbacks are in play: `usage.iterations` lists each one. Attempts that were
 * declined before producing output are reported but not billed by the provider,
 * so the top-level `usage` remains the correct basis for the served message.
 * This surfaces the case for logging rather than silently ignoring it.
 */
export function describeIterations(usage: any): string | null {
  const iterations = usage?.iterations;
  if (!Array.isArray(iterations) || iterations.length <= 1) return null;
  return iterations.map((i: any) => i?.type ?? 'message').join(' → ');
}

let client: Anthropic | null = null;

/** Lazily constructed so the server still boots without an upstream key. */
export function anthropicClient(): Anthropic {
  if (!config.anthropic.apiKey) {
    throw new HttpError(
      503,
      'Model access is not configured on this server.',
      'model_provider_unconfigured',
    );
  }
  client ??= new Anthropic({ apiKey: config.anthropic.apiKey });
  return client;
}

export const isModelProviderConfigured = (): boolean => Boolean(config.anthropic.apiKey);
