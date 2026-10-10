/**
 * Request scope for AI calls that do not receive an org id of their own.
 * Ask enters this before the research loop so Tavily (and similar) can
 * record provider cost on the same org without threading a client through
 * every tool.
 *
 * Background video work (day reading, narration, long-form analysis,
 * transcription enrichment, summaries) runs inside a scope with
 * `meterFeature` set. Inside such a scope every provider call that does not
 * meter itself is recorded on the org's ledger under that feature
 * (`meterBackgroundUsage` in tokenUsage.ts). Ask turns enter a scope WITHOUT
 * `meterFeature`: they add up their own usage and record it once per turn, so
 * nothing is counted twice.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { SupabaseClient } from '@supabase/supabase-js';

export type AiUsageScope = {
  client: SupabaseClient;
  orgId: string;
  requestId: string;
  jobId?: string | null;
  userId?: string | null;
  /** When set, provider calls in this scope are metered under this feature. */
  meterFeature?: string | null;
  /** Background video work: the clip this scope is analysing (per-clip call cap). */
  proofId?: string | null;
};

const storage = new AsyncLocalStorage<AiUsageScope>();

export function enterAiUsageScope(scope: AiUsageScope): void {
  storage.enterWith(scope);
}

/** Run `fn` inside `scope` without leaking the scope to the caller. */
export function runWithAiUsageScope<T>(scope: AiUsageScope, fn: () => Promise<T>): Promise<T> {
  return storage.run(scope, fn);
}

export function currentAiUsageScope(): AiUsageScope | undefined {
  return storage.getStore();
}
