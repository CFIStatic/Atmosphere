/**
 * Guard so no provider ever receives another provider's model id.
 *
 * Incident (Oct 19 2026): video escalation fell back to Gemini but passed the
 * Anthropic id `claude-haiku-4-5`; Google returned 404 and the video failed.
 */

export type ModelFamily = 'google' | 'anthropic' | 'openai' | 'unknown';

export function modelFamily(model: string | null | undefined): ModelFamily {
  const id = String(model ?? '').trim().toLowerCase().replace(/^models\//, '');
  if (!id) return 'unknown';
  if (/^(gemini|gemma|learnlm|imagen|veo)\b|^gemini-/.test(id)) return 'google';
  if (/^claude/.test(id)) return 'anthropic';
  if (/^(gpt|o\d|chatgpt|text-embedding|dall-e|whisper)/.test(id)) return 'openai';
  return 'unknown';
}

/**
 * Return `model` when it belongs to `provider`; otherwise `fallback`.
 * Throws only when neither fits, so a misconfiguration fails loudly instead of
 * sending a foreign id to the wrong API.
 */
export function modelForProvider(
  provider: Exclude<ModelFamily, 'unknown'>,
  model: string | null | undefined,
  fallback: string,
): string {
  const fam = modelFamily(model);
  if (model && (fam === provider || fam === 'unknown')) return String(model).trim();
  const fbFam = modelFamily(fallback);
  if (fbFam === provider || fbFam === 'unknown') return fallback.trim();
  throw new Error(`No ${provider} model available (got ${model ?? 'none'} and ${fallback})`);
}

export function assertModelForProvider(provider: Exclude<ModelFamily, 'unknown'>, model: string): void {
  const fam = modelFamily(model);
  if (fam !== 'unknown' && fam !== provider) {
    throw new Error(`Refusing to send ${fam} model "${model}" to ${provider}`);
  }
}
