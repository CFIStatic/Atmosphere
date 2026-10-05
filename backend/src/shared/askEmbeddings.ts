/**
 * OpenAI text-embedding-3-small for Ask retrieval.
 *
 * Uses OPENAI_API_KEY (same key as transcription). Embeddings are optional:
 * when the key is missing, callers keep lexical/local retrieval.
 */
import { createHash } from 'node:crypto';

export const ASK_EMBEDDING_MODEL = 'text-embedding-3-small';
export const ASK_EMBEDDING_DIMS = 1536;

export function openaiEmbeddingsApiKey(): string {
  return (process.env.OPENAI_API_KEY ?? process.env.ASK_EMBEDDING_API_KEY ?? '').trim();
}

export function askEmbeddingsEnabled(): boolean {
  if ((process.env.ASK_EMBEDDINGS ?? '1').trim() === '0') return false;
  return Boolean(openaiEmbeddingsApiKey());
}

/** Cosine similarity for equal-length unit-ish vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na <= 0 || nb <= 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function embeddingCacheKey(text: string, model = ASK_EMBEDDING_MODEL): string {
  return createHash('sha256').update(`${model}\n${text}`).digest('hex');
}

type EmbedCacheEntry = { vector: number[]; at: number };
const embedCache = new Map<string, EmbedCacheEntry>();
const EMBED_CACHE_MAX = 512;

function remember(key: string, vector: number[]): void {
  if (embedCache.has(key)) embedCache.delete(key);
  embedCache.set(key, { vector, at: Date.now() });
  while (embedCache.size > EMBED_CACHE_MAX) {
    const oldest = embedCache.keys().next().value;
    if (oldest == null) break;
    embedCache.delete(oldest);
  }
}

export function resetAskEmbeddingCacheForTests(): void {
  embedCache.clear();
}

/**
 * Embed one or more strings. Returns null when embeddings are disabled or the
 * provider errors — callers must fall back to lexical retrieval.
 */
export async function embedTexts(
  texts: string[],
  opts?: { fetchFn?: typeof fetch; apiKey?: string | null; model?: string },
): Promise<number[][] | null> {
  const cleaned = texts.map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (!cleaned.length) return [];
  const apiKey = (opts?.apiKey ?? openaiEmbeddingsApiKey()).trim();
  if (!apiKey || (process.env.ASK_EMBEDDINGS ?? '1').trim() === '0') return null;
  const model = (opts?.model ?? ASK_EMBEDDING_MODEL).trim() || ASK_EMBEDDING_MODEL;
  const fetchFn = opts?.fetchFn ?? fetch;

  const out: Array<number[] | null> = cleaned.map(() => null);
  const missing: Array<{ i: number; text: string }> = [];
  cleaned.forEach((text, i) => {
    const hit = embedCache.get(embeddingCacheKey(text, model));
    if (hit) out[i] = hit.vector;
    else missing.push({ i, text });
  });
  if (!missing.length) return out as number[][];

  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  try {
    const response = await fetchFn(`${base}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, input: missing.map((row) => row.text.slice(0, 8000)) }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 200);
      // eslint-disable-next-line no-console
      console.warn(`[ask-embed] OpenAI ${response.status}: ${detail}`);
      return null;
    }
    const payload = (await response.json()) as {
      data?: Array<{ embedding?: number[]; index?: number }>;
    };
    for (const row of payload.data ?? []) {
      const vec = row.embedding;
      if (!Array.isArray(vec) || !vec.length) continue;
      const local = missing[row.index ?? 0];
      if (!local) continue;
      remember(embeddingCacheKey(local.text, model), vec);
      out[local.i] = vec;
    }
    if (out.some((v) => !v)) return null;
    return out as number[][];
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[ask-embed] failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200));
    return null;
  }
}

export async function embedText(
  text: string,
  opts?: { fetchFn?: typeof fetch; apiKey?: string | null },
): Promise<number[] | null> {
  const rows = await embedTexts([text], opts);
  return rows?.[0] ?? null;
}
