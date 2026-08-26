/**
 * Which vision keys this process can actually use.
 *
 * Scope of Work reads video frames. Verification already uses Gemini.
 * Dictation used to require Anthropic only, so a box with Google keys and
 * no Anthropic key skipped every clip and the office sat on "Writing…".
 *
 * Prefer GEMINI_API_KEY. GOOGLE_API_KEY is often a Maps-restricted key —
 * calling generativelanguage.googleapis.com with it returns 403
 * API_KEY_SERVICE_BLOCKED.
 */

export function googleVisionApiKeys(): string[] {
  const gemini = (process.env.GEMINI_API_KEY ?? '').trim();
  // When GEMINI_API_KEY is set, use only that. GOOGLE_API_KEY is often a
  // Maps-restricted key and 403s generativelanguage.googleapis.com.
  if (gemini) return [gemini];
  const google = (process.env.GOOGLE_API_KEY ?? '').trim();
  return google ? [google] : [];
}

export function googleVisionApiKey(): string {
  return googleVisionApiKeys()[0] ?? '';
}

export function anthropicVisionApiKey(): string {
  return (process.env.ANTHROPIC_API_KEY || '').trim();
}

export function isVisionConfigured(): boolean {
  return Boolean(googleVisionApiKey() || anthropicVisionApiKey());
}

export function visionProviderLabel(): 'google' | 'anthropic' | 'unconfigured' {
  if (googleVisionApiKey()) return 'google';
  if (anthropicVisionApiKey()) return 'anthropic';
  return 'unconfigured';
}

export function isGeminiKeyBlocked(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  return /API_KEY_SERVICE_BLOCKED|Requests to this API .+ are blocked/i.test(text);
}

/** Short office-facing line. Do not dump the Google JSON blob into Scope of Work. */
export function formatVisionFailure(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  if (isGeminiKeyBlocked(err)) {
    return 'Gemini refused this key (API_KEY_SERVICE_BLOCKED). Put a Generative Language key in GEMINI_API_KEY — not a Maps-restricted GOOGLE_API_KEY.';
  }
  return text.replace(/\s+/g, ' ').slice(0, 280);
}
