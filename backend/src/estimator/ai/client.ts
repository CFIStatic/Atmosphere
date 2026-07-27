import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config.js';

/**
 * Shared Anthropic client for the estimator's reading tasks — damage from
 * photos, intent from CRM notes.
 *
 * The client is created once and reused so prompt caching actually pays off:
 * the system prompts here are large and identical across every photo in a run,
 * which is precisely the shape caching is designed for.
 *
 * The model is a hard dependency for the *vision* stages only. If no API key is
 * configured the pipeline still runs — it builds scope from DocuSketch
 * measurements and the mitigation estimate, and says so in the run warnings.
 * That degradation is deliberate: the mitigation-derived rebuild is the highest
 * confidence path anyway, and it needs no model at all.
 */

let client: Anthropic | null = null;

export function isModelAvailable(): boolean {
  return Boolean(config.estimator.anthropicApiKey);
}

export function anthropic(): Anthropic {
  if (!config.estimator.anthropicApiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }
  client ??= new Anthropic({
    apiKey: config.estimator.anthropicApiKey,
    // The SDK already retries 429/5xx with backoff; one extra attempt costs
    // little and photo batches are exactly where a rate limit shows up.
    maxRetries: 3,
    // Milliseconds in the TypeScript SDK. Generous, because adaptive thinking
    // on a dense photo can legitimately run long.
    timeout: 5 * 60 * 1000,
  });
  return client;
}

/**
 * Pull the JSON payload out of a structured-outputs response.
 *
 * With `output_config.format` set, the first text block is guaranteed to be
 * schema-valid JSON — but a refusal or a `max_tokens` stop produces no usable
 * text at all, and treating that as "no findings" would silently drop damage.
 * Both cases throw instead.
 */
export function readStructuredJson<T>(message: Anthropic.Message, context: string): T {
  if (message.stop_reason === 'refusal') {
    throw new Error(`${context}: the model declined to answer`);
  }
  if (message.stop_reason === 'max_tokens') {
    throw new Error(`${context}: response was cut off before it finished — raise max_tokens`);
  }

  const text = message.content.find((block) => block.type === 'text');
  if (!text || text.type !== 'text' || !text.text.trim()) {
    throw new Error(`${context}: response contained no text`);
  }

  try {
    return JSON.parse(text.text) as T;
  } catch {
    throw new Error(`${context}: response was not valid JSON`);
  }
}

/**
 * Run tasks with bounded concurrency.
 *
 * Photos are analysed in parallel because a 40-photo run would otherwise take
 * minutes of pure wall-clock waiting — but unbounded parallelism would trip the
 * per-minute token limit and turn the whole batch into retries.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        results[index] = { status: 'fulfilled', value: await worker(items[index]!, index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  });

  await Promise.all(runners);
  return results;
}
