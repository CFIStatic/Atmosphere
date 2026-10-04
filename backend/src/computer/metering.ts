/**
 * Computer metering, on the same ledger and 10× markup as the rest of AI:
 *
 * - Agent tokens: recordMeasuredTokenUsage path (awaited variant), feature
 *   'computer', source 'computer_agent', one row per model call.
 * - Browser time: recordFlatProviderCost, feature 'computer', source
 *   'computer_session', priced from modelPriceTable().browserUsdPerHour
 *   (COMPUTER_BROWSER_USD_PER_HOUR overrides), whole minutes, 1-minute minimum.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { tryExtractUsage } from '../lib/anthropic.js';
import { browserMinutes, browserTimeCostNanos, modelPriceTable } from '../metering/modelPriceTable.js';
import { providerCostForUsage } from '../metering/pricing.js';
import { recordFlatProviderCost, recordMeasuredTokenUsageAsync } from '../metering/tokenUsage.js';
import type { ComputerModelResponse } from './agent.js';

export const COMPUTER_FEATURE = 'computer';
export const BROWSER_MODEL_ID = 'browserbase-browser-time';

export async function meterComputerModelCall(
  client: SupabaseClient | null,
  input: { orgId: string; taskId: string; jobId: string | null; userId: string | null; step: number; response: ComputerModelResponse },
): Promise<number> {
  const usage = tryExtractUsage(input.response.usage, input.response.model);
  const cost = providerCostForUsage(input.response.model, usage).costNanos;
  if (!client || usage.totalTokens <= 0) return cost;
  try {
    await recordMeasuredTokenUsageAsync(client, {
      orgId: input.orgId,
      requestId: `computer:${input.taskId}:model:${input.step}`,
      feature: COMPUTER_FEATURE,
      source: 'computer_agent',
      userId: input.userId,
      jobId: input.jobId,
      modelId: input.response.model,
      usage,
    });
  } catch (err) {
    console.error('[computer] failed to record agent tokens', { orgId: input.orgId, taskId: input.taskId, err });
  }
  return cost;
}

export function browserCostSoFar(seconds: number): number {
  return browserTimeCostNanos(modelPriceTable(), seconds);
}

export function meterBrowserTime(
  client: SupabaseClient | null,
  input: { orgId: string; taskId: string; sessionId: string; jobId: string | null; userId: string | null; seconds: number },
): number {
  const table = modelPriceTable();
  const costNanos = browserTimeCostNanos(table, input.seconds);
  if (client) {
    recordFlatProviderCost(client, {
      orgId: input.orgId,
      requestId: `computer:${input.taskId}:browser:${input.sessionId}`,
      feature: COMPUTER_FEATURE,
      source: 'computer_session',
      modelId: BROWSER_MODEL_ID,
      provider: 'browserbase',
      costNanos,
      jobId: input.jobId,
      userId: input.userId,
      metadata: {
        browserSeconds: Math.round(input.seconds),
        billedMinutes: browserMinutes(input.seconds),
        usdPerHour: table.browserUsdPerHour,
      },
    });
  }
  return costNanos;
}
