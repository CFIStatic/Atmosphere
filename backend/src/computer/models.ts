/**
 * Which Claude models can drive a computer, and on what terms.
 *
 * Two things vary per model and both matter for correctness:
 *
 *   • **Tool version + beta header.** `computer_20251124` (with its
 *     `computer-use-2025-11-24` header) adds the `zoom` action; older models
 *     only understand `computer_20250124`. Sending the wrong pair is a 400.
 *
 *   • **Image limits.** If a screenshot exceeds the model's per-image limits
 *     the API downscales it server-side — and then Claude answers in a
 *     coordinate space we never computed, so every click lands in the wrong
 *     place. We therefore downscale on the agent, which means we have to know
 *     each model's ceiling exactly.
 */

export interface ComputerModel {
  id: string;
  label: string;
  /** Tool `type` string for this model's computer tool. */
  toolType: 'computer_20251124' | 'computer_20250124';
  /** Beta header this tool version requires. */
  beta: 'computer-use-2025-11-24' | 'computer-use-2025-01-24';
  /** Longest permitted image edge, in pixels. */
  maxLongEdge: number;
  /** Total permitted pixels per image. */
  maxPixels: number;
  /** `zoom` needs `enable_zoom: true` and only exists on the newer tool. */
  supportsZoom: boolean;
}

/** High-resolution tier: 2576 px on the long edge, 3.75 MP total. */
const HIGH_RES = { maxLongEdge: 2576, maxPixels: 3_750_000 };
/** Everything older: 1568 px on the long edge, ~1.15 MP total. */
const STANDARD_RES = { maxLongEdge: 1568, maxPixels: 1_150_000 };

export const COMPUTER_MODELS: ComputerModel[] = [
  {
    id: 'claude-opus-5',
    label: 'Claude Opus 5',
    toolType: 'computer_20251124',
    beta: 'computer-use-2025-11-24',
    supportsZoom: true,
    ...HIGH_RES,
  },
  {
    id: 'claude-sonnet-5',
    label: 'Claude Sonnet 5',
    toolType: 'computer_20251124',
    beta: 'computer-use-2025-11-24',
    supportsZoom: true,
    ...HIGH_RES,
  },
  {
    id: 'claude-opus-4-8',
    label: 'Claude Opus 4.8',
    toolType: 'computer_20251124',
    beta: 'computer-use-2025-11-24',
    supportsZoom: true,
    ...HIGH_RES,
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    toolType: 'computer_20251124',
    beta: 'computer-use-2025-11-24',
    supportsZoom: true,
    ...STANDARD_RES,
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
    toolType: 'computer_20250124',
    beta: 'computer-use-2025-01-24',
    supportsZoom: false,
    ...STANDARD_RES,
  },
];

export const DEFAULT_MODEL_ID = 'claude-opus-5';

export function findModel(id: string | undefined): ComputerModel {
  const model = COMPUTER_MODELS.find((m) => m.id === (id ?? DEFAULT_MODEL_ID));
  if (!model) {
    throw new Error(
      `Unknown model "${id}". Choose one of: ${COMPUTER_MODELS.map((m) => m.id).join(', ')}.`,
    );
  }
  return model;
}

/**
 * Capture presets.
 *
 * Screenshots dominate the token bill of a computer-use run, and more pixels is
 * not uniformly better: Anthropic's own guidance for computer use is that
 * around 1080p balances accuracy against cost, with lower resolutions still
 * performing well. So the operator picks an intent and we clamp it to whatever
 * the chosen model actually allows.
 */
export type CaptureQuality = 'economical' | 'balanced' | 'detailed';

const QUALITY_LIMITS: Record<CaptureQuality, { maxLongEdge: number; maxPixels: number }> = {
  economical: { maxLongEdge: 1366, maxPixels: 1_050_000 },
  balanced: { maxLongEdge: 1920, maxPixels: 2_100_000 },
  detailed: { maxLongEdge: Number.MAX_SAFE_INTEGER, maxPixels: Number.MAX_SAFE_INTEGER },
};

export function imageLimitsFor(
  model: ComputerModel,
  quality: CaptureQuality,
): { maxLongEdge: number; maxPixels: number } {
  const preset = QUALITY_LIMITS[quality];
  return {
    maxLongEdge: Math.min(model.maxLongEdge, preset.maxLongEdge),
    maxPixels: Math.min(model.maxPixels, preset.maxPixels),
  };
}

/** The largest factor ≤ 1 that brings a screen inside the model's limits. */
export function scaleFactorFor(
  width: number,
  height: number,
  limits: { maxLongEdge: number; maxPixels: number },
): number {
  const longEdge = Math.max(width, height);
  const totalPixels = width * height;
  return Math.min(1, limits.maxLongEdge / longEdge, Math.sqrt(limits.maxPixels / totalPixels));
}
