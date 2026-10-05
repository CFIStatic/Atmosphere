/**
 * Claude computer use through the existing Anthropic provider and key.
 * COMPUTER_AGENT_MODEL picks the model (default claude-sonnet-5) and is
 * separate from every Chat model setting.
 *
 * The SDK in this repo predates computer_toolset_20260801, so the request is
 * passed through untyped; the API accepts it on the standard Messages
 * endpoint with no beta header.
 */
import { anthropicClientForKey, resolveAskApiKey } from '../lib/anthropic.js';
import type { ComputerModel, ComputerModelRequest, ComputerModelResponse } from './agent.js';

export async function anthropicComputerModel(orgId: string): Promise<ComputerModel | null> {
  const key = await resolveAskApiKey(orgId);
  if (!key) return null;
  const client = anthropicClientForKey(key);
  return {
    async create(request: ComputerModelRequest): Promise<ComputerModelResponse> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = (await client.messages.create(request as any)) as any;
      return {
        model: String(res.model ?? request.model),
        content: Array.isArray(res.content) ? res.content : [],
        usage: res.usage ?? null,
        stop_reason: res.stop_reason ?? null,
      };
    },
  };
}
