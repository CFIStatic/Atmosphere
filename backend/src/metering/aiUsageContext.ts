/**
 * Request scope for AI calls that do not receive an org id of their own.
 * Ask enters this before the research loop so Tavily (and similar) can
 * record provider cost on the same org without threading a client through
 * every tool.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { SupabaseClient } from '@supabase/supabase-js';

export type AiUsageScope = {
  client: SupabaseClient;
  orgId: string;
  requestId: string;
  jobId?: string | null;
  userId?: string | null;
};

const storage = new AsyncLocalStorage<AiUsageScope>();

export function enterAiUsageScope(scope: AiUsageScope): void {
  storage.enterWith(scope);
}

export function currentAiUsageScope(): AiUsageScope | undefined {
  return storage.getStore();
}
