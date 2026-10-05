/**
 * Keep long-lived deployments off Anthropic model IDs that have reached EOL.
 *
 * Railway can retain an explicit model pin for months, so changing a source
 * default alone is not enough. Normalize known retired pins at runtime while
 * preserving any current operator-selected model.
 */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';

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

/**
 * Still-served pins we supersede so long-lived Railway env values move to the
 * current lineup without a dashboard edit. Operators who need a prior pin can
 * set ANTHROPIC_MODEL_PIN=1 to keep the configured id.
 */
const SUPERSEDED_ANTHROPIC_MODELS: Record<string, string> = {
  'claude-opus-5': 'claude-opus-5-5',
  'claude-opus-4-8': 'claude-opus-5-5',
  'claude-opus-4-7': 'claude-opus-5-5',
  'claude-opus-4-6': 'claude-opus-5-5',
  'claude-sonnet-5': 'claude-sonnet-5-5',
  'claude-sonnet-4-6': 'claude-sonnet-5-5',
  'claude-fable-5': 'claude-fable-5-1',
};

export function isRetiredAnthropicModel(model: string | null | undefined): boolean {
  return RETIRED_ANTHROPIC_MODELS.has((model ?? '').trim().toLowerCase());
}

export function resolveAnthropicModel(
  ...candidates: Array<string | null | undefined>
): string {
  const configured = candidates.map((value) => (value ?? '').trim()).find(Boolean);
  if (!configured || isRetiredAnthropicModel(configured)) return DEFAULT_ANTHROPIC_MODEL;
  if ((process.env.ANTHROPIC_MODEL_PIN ?? '').trim() === '1') return configured;
  const upgraded = SUPERSEDED_ANTHROPIC_MODELS[configured.toLowerCase()];
  return upgraded ?? configured;
}

/** A terminal failure made by a retired pin is safe to retry after this guard ships. */
export function isRetiredAnthropicModelError(error: string | null | undefined): boolean {
  const detail = (error ?? '').toLowerCase();
  return [...RETIRED_ANTHROPIC_MODELS].some((model) => detail.includes(model));
}
