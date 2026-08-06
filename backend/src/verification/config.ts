/**
 * Configurable thresholds and limits for the verification pipeline.
 *
 * Environment overrides keep cost and quality knobs out of code deploys.
 */

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const verificationConfig = {
  /** Private storage bucket for originals and extracted frames. */
  bucket: process.env.VERIFICATION_STORAGE_BUCKET ?? 'job-proofs',

  /** Upload constraints. */
  maxUploadBytes: num('VERIFICATION_MAX_UPLOAD_BYTES', 1_500_000_000),
  maxDurationSeconds: num('VERIFICATION_MAX_DURATION_SECONDS', 2 * 60 * 60),
  minDurationSeconds: num('VERIFICATION_MIN_DURATION_SECONDS', 5),
  signedUploadTtlSeconds: num('VERIFICATION_SIGNED_UPLOAD_TTL_SECONDS', 30 * 60),
  signedDownloadTtlSeconds: num('VERIFICATION_SIGNED_DOWNLOAD_TTL_SECONDS', 10 * 60),

  /** Frame extraction. */
  frameIntervalSeconds: num('VERIFICATION_FRAME_INTERVAL_SECONDS', 2),
  maxFramesPerVideo: num('VERIFICATION_MAX_FRAMES_PER_VIDEO', 120),
  sceneChangeThreshold: num('VERIFICATION_SCENE_CHANGE_THRESHOLD', 0.35),
  extractKeyframes: process.env.VERIFICATION_EXTRACT_KEYFRAMES !== 'false',
  thumbnailWidth: num('VERIFICATION_THUMBNAIL_WIDTH', 480),

  /** Quality / dedup — goal: cut model calls ≥80%. */
  minQualityScore: num('VERIFICATION_MIN_QUALITY_SCORE', 0.35),
  maxBlurScore: num('VERIFICATION_MAX_BLUR_SCORE', 0.72),
  minBrightness: num('VERIFICATION_MIN_BRIGHTNESS', 0.08),
  maxBrightness: num('VERIFICATION_MAX_BRIGHTNESS', 0.95),
  maxMotionScore: num('VERIFICATION_MAX_MOTION_SCORE', 0.85),
  duplicateHammingThreshold: num('VERIFICATION_DUPLICATE_HAMMING', 8),
  duplicateCosineThreshold: num('VERIFICATION_DUPLICATE_COSINE', 0.92),
  targetAnalysisFrameRatio: num('VERIFICATION_TARGET_ANALYSIS_RATIO', 0.2),

  /** Models. */
  primaryProvider: (process.env.VERIFICATION_PRIMARY_PROVIDER ?? 'google') as
    | 'google'
    | 'anthropic'
    | 'openai',
  primaryModel: process.env.VERIFICATION_PRIMARY_MODEL ?? 'gemini-2.0-flash',
  escalationProvider: (process.env.VERIFICATION_ESCALATION_PROVIDER ?? 'anthropic') as
    | 'google'
    | 'anthropic'
    | 'openai',
  escalationModel: process.env.VERIFICATION_ESCALATION_MODEL ?? 'claude-sonnet-4-20250514',
  promptVersion: process.env.VERIFICATION_PROMPT_VERSION ?? 'v1',

  /** Confidence / escalation. */
  escalateBelowConfidence: num('VERIFICATION_ESCALATE_BELOW', 0.55),
  likelyVerifiedThreshold: num('VERIFICATION_LIKELY_THRESHOLD', 0.7),
  verifiedThreshold: num('VERIFICATION_VERIFIED_THRESHOLD', 0.85),
  disagreementDelta: num('VERIFICATION_DISAGREEMENT_DELTA', 0.25),

  /** Cost controls. */
  defaultMonthlyBudgetUsd: num('VERIFICATION_DEFAULT_MONTHLY_BUDGET_USD', 250),
  geminiInputPerMTokUsd: num('VERIFICATION_GEMINI_INPUT_USD_PER_MTOK', 0.1),
  geminiOutputPerMTokUsd: num('VERIFICATION_GEMINI_OUTPUT_USD_PER_MTOK', 0.4),
  anthropicInputPerMTokUsd: num('VERIFICATION_ANTHROPIC_INPUT_USD_PER_MTOK', 3),
  anthropicOutputPerMTokUsd: num('VERIFICATION_ANTHROPIC_OUTPUT_USD_PER_MTOK', 15),

  /** Pipeline. */
  pipelineVersion: process.env.VERIFICATION_PIPELINE_VERSION ?? 'v1',
  maxStepAttempts: num('VERIFICATION_MAX_STEP_ATTEMPTS', 3),
  ffmpegPath: process.env.FFMPEG_PATH ?? 'ffmpeg',
  ffprobePath: process.env.FFPROBE_PATH ?? 'ffprobe',
} as const;

export type VerificationConfig = typeof verificationConfig;
