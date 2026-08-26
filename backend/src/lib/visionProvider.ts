/**
 * Which vision keys this process can actually use.
 *
 * Scope of Work reads video frames. Verification already uses Gemini
 * (GOOGLE_API_KEY / GEMINI_API_KEY). Dictation used to require Anthropic only,
 * so a box with Google keys and no Anthropic key skipped every clip and the
 * office sat on "Writing…".
 */

export function googleVisionApiKey(): string {
  return (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '').trim();
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
