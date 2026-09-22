/**
 * Keep long-lived deployments off Anthropic model IDs that have reached EOL.
 *
 * Railway can retain an explicit model pin for months, so changing a source
 * default alone is not enough. Normalize known retired pins at runtime while
 * preserving any current operator-selected model.
 */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5';

const RETIRED_ANTHROPIC_MODELS = new Set([
  'claude-opus-4-1',
  'claude-opus-4-1-20250805',
  'claude-opus-4',
  'claude-opus-4-20250514',
  'claude-sonnet-4',
  'claude-sonnet-4-20250514',
  'claude-3-7-sonnet-20250219',
  'claude-3-5-haiku-20241022',
  'claude-3-haiku-20240307',
]);

export function isRetiredAnthropicModel(model: string | null | undefined): boolean {
  return RETIRED_ANTHROPIC_MODELS.has((model ?? '').trim().toLowerCase());
}

export function resolveAnthropicModel(
  ...candidates: Array<string | null | undefined>
): string {
  const configured = candidates.map((value) => (value ?? '').trim()).find(Boolean);
  if (!configured || isRetiredAnthropicModel(configured)) return DEFAULT_ANTHROPIC_MODEL;
  return configured;
}

/** A terminal failure made by a retired pin is safe to retry after this guard ships. */
export function isRetiredAnthropicModelError(error: string | null | undefined): boolean {
  const detail = (error ?? '').toLowerCase();
  return [...RETIRED_ANTHROPIC_MODELS].some((model) => detail.includes(model));
}
