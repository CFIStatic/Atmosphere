/**
 * Prompt caching for Ask.
 *
 * Anthropic: the system prompt and the stable job context are the prefix,
 * each marked with cache_control so a later question on the same job reuses
 * them. The question, the thread, and tool results stay after that prefix.
 *
 * Gemini: the same prefix is sent first (implicit cache). An explicit
 * cachedContents entry is created in the background on the second sight of
 * a prefix and used once it is ready. The first request never waits on it.
 */
import { createHash } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';

export type AnthropicSystemBlock = {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral'; ttl?: '5m' | '1h' };
};

/** Stable instructions, then stable job context. Both are cache breakpoints. */
export function anthropicCachedSystem(system: string, stableContext: string): AnthropicSystemBlock[] {
  const blocks: AnthropicSystemBlock[] = [
    {
      type: 'text',
      text: system,
      cache_control: { type: 'ephemeral', ttl: '1h' },
    },
  ];
  const stable = stableContext.trim();
  if (stable) {
    blocks.push({
      type: 'text',
      text: stable,
      cache_control: { type: 'ephemeral', ttl: '1h' },
    });
  }
  return blocks;
}

export function geminiSystemPrefix(system: string, stableContext: string): string {
  const stable = stableContext.trim();
  return stable ? `${system.trim()}\n\n${stable}` : system.trim();
}

type GeminiCacheState = 'seen' | 'creating' | 'ready' | 'unsupported';

type GeminiCacheEntry = {
  state: GeminiCacheState;
  name: string | null;
  expires: number;
};

const GEMINI_CACHE_MAX = 128;
const geminiCaches = new Map<string, GeminiCacheEntry>();
const geminiCacheWrites = new Set<Promise<void>>();

function rememberGeminiCache(key: string, entry: GeminiCacheEntry): void {
  if (geminiCaches.has(key)) geminiCaches.delete(key);
  geminiCaches.set(key, entry);
  while (geminiCaches.size > GEMINI_CACHE_MAX) {
    const oldest = geminiCaches.keys().next().value;
    if (oldest == null) break;
    geminiCaches.delete(oldest);
  }
}

export function resetGeminiContextCachesForTests(): void {
  geminiCaches.clear();
  geminiCacheWrites.clear();
}

function cacheKey(parts: string[]): string {
  return createHash('sha256').update(parts.join('\n---\n')).digest('hex');
}

export function geminiCacheCreateBody(input: {
  model: string;
  system: string;
  stable: string;
  tools?: unknown;
}): Record<string, unknown> {
  const model = input.model.startsWith('models/') ? input.model : `models/${input.model}`;
  const body: Record<string, unknown> = {
    model,
    systemInstruction: { parts: [{ text: input.system }] },
    contents: [{ role: 'user', parts: [{ text: input.stable }] }],
    ttl: '3600s',
  };
  if (input.tools) body.tools = input.tools;
  return body;
}

async function createGeminiCache(
  input: {
    apiKey: string;
    model: string;
    system: string;
    stable: string;
    tools?: unknown;
    fetchFn?: typeof fetch;
  },
  key: string,
): Promise<void> {
  const fetchFn = input.fetchFn ?? fetch;
  const base = (process.env.GOOGLE_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
  const url = `${base}/v1beta/cachedContents`;
  try {
    const response = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': input.apiKey },
      body: JSON.stringify(geminiCacheCreateBody(input)),
    });
    const row = geminiCaches.get(key);
    if (!row) return;
    if (!response.ok) {
      row.state = response.status === 400 ? 'unsupported' : 'seen';
      return;
    }
    const payload = (await response.json()) as { name?: string };
    const name = (payload.name ?? '').trim();
    if (!name) {
      row.state = 'seen';
      return;
    }
    row.state = 'ready';
    row.name = name;
    row.expires = Date.now() + 50 * 60 * 1000;
  } catch {
    const row = geminiCaches.get(key);
    if (row && row.state === 'creating') row.state = 'seen';
  }
}

/**
 * Returns a cachedContents name when one is already warm.
 * The first sight records the prefix and does not call the network.
 * The second sight starts creation and still returns null so this request
 * is not blocked. Later requests reuse the name.
 */
export function geminiCachedContentName(input: {
  apiKey: string;
  model: string;
  system: string;
  stable: string;
  tools?: unknown;
  fetchFn?: typeof fetch;
}): string | null {
  if ((process.env.ASK_GEMINI_CONTEXT_CACHE ?? '1').trim() === '0') return null;
  const stable = input.stable.trim();
  if (stable.length < 800) return null;
  const key = cacheKey([input.model, input.system, stable, JSON.stringify(input.tools ?? null)]);
  const existing = geminiCaches.get(key);
  if (existing?.state === 'ready' && existing.name && existing.expires > Date.now()) return existing.name;
  if (existing?.state === 'unsupported' || existing?.state === 'creating') return null;
  if (!existing) {
    rememberGeminiCache(key, { state: 'seen', name: null, expires: 0 });
    return null;
  }
  // Refresh recency so a warm prefix is not the first one evicted.
  rememberGeminiCache(key, existing);
  existing.state = 'creating';
  const pending = createGeminiCache(input, key);
  geminiCacheWrites.add(pending);
  void pending.finally(() => geminiCacheWrites.delete(pending));
  return null;
}

/** Tests wait until background cache creates have settled. */
export async function flushGeminiContextCaches(): Promise<void> {
  await Promise.all([...geminiCacheWrites]);
}

/** Type helper so call sites stay aligned with the SDK's system parameter. */
export function asAnthropicSystem(blocks: AnthropicSystemBlock[]): Anthropic.TextBlockParam[] {
  return blocks as Anthropic.TextBlockParam[];
}
