import { AsyncLocalStorage } from 'node:async_hooks';
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

/**
 * The organisation's own key, in scope for the duration of one job or request.
 *
 * An org can connect its own Anthropic key in the UI — that is the product's
 * promise, and it puts their model spend on their own account. Until now only
 * computer use read that key: every other model call in the system went
 * straight to `ANTHROPIC_API_KEY` and reported "Model access is not configured
 * on this server" when the env var was unset, however many keys the org had
 * connected. That is a clip that never gets read on a server that could read
 * it.
 *
 * Carried in AsyncLocalStorage rather than threaded through signatures because
 * "which account pays for this call" is ambient to the work, not an argument
 * to each of the thirteen call sites — and a parameter that thirteen callers
 * have to remember to pass is a parameter twelve of them will eventually
 * forget. Entry points that know the org wrap their work in `withOrgApiKey`;
 * everything underneath keeps calling `anthropicClient()` unchanged.
 */
const orgKeyScope = new AsyncLocalStorage<string>();

/**
 * Run `fn` with this organisation's key in scope. A null key is not an error —
 * it simply means the org has not connected one, and the work falls back to
 * the server-wide key exactly as before.
 */
export function withOrgApiKey<T>(apiKey: string | null | undefined, fn: () => T): T {
  const key = apiKey?.trim();
  return key ? orgKeyScope.run(key, fn) : fn();
}

/** The key this call should bill: the org's if one is in scope, else the server's. */
function activeApiKey(): string {
  return orgKeyScope.getStore() || config.anthropic.apiKey;
}

let serverClient: Anthropic | null = null;
/**
 * One client per org key. Capped, because the SDK holds an agent and a
 * connection pool, and an unbounded map keyed by secret would be both a leak
 * and a pile of live credentials in memory.
 */
const orgClients = new Map<string, Anthropic>();
const MAX_ORG_CLIENTS = 32;

/** Lazily constructed so the server still boots without an upstream key. */
export function anthropicClient(): Anthropic {
  const apiKey = activeApiKey();
  if (!apiKey) {
    throw new HttpError(
      503,
      'Model access is not configured on this server.',
      'model_provider_unconfigured',
    );
  }
  if (apiKey === config.anthropic.apiKey) {
    serverClient ??= new Anthropic({ apiKey });
    return serverClient;
  }
  let scoped = orgClients.get(apiKey);
  if (!scoped) {
    if (orgClients.size >= MAX_ORG_CLIENTS) {
      // Oldest first — Map preserves insertion order.
      const oldest = orgClients.keys().next().value;
      if (oldest !== undefined) orgClients.delete(oldest);
    }
    scoped = new Anthropic({ apiKey });
    orgClients.set(apiKey, scoped);
  }
  return scoped;
}

export const isModelProviderConfigured = (): boolean => Boolean(activeApiKey());
