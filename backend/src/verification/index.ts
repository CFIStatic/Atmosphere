/**
 * Video work-verification pipeline.
 *
 * Extends the existing proof-of-work media layer (`job_proofs`) with a durable
 * multi-stage analysis pipeline. Visual models propose observations; the LLM
 * is the primary verifier/reviewer; humans are exception-only.
 */

export * from './types.js';
export * from './schemas.js';
export * from './config.js';
export {
  createVideoUpload,
  completeVideoUpload,
  getVideoForOrg,
  createSignedPlaybackUrl,
  linkProofAsVerificationVideo,
  validateUploadConstraints,
  buildStoragePath,
} from './ingestion/service.js';
export {
  ProcessingOrchestrator,
  pipelineIdempotencyKey,
} from './pipeline/orchestrator.js';
export {
  createVerificationOrchestrator,
  getVerificationOrchestrator,
  setVerificationOrchestratorForTests,
  createDefaultAnalyzer,
} from './factory.js';
export { verificationRouter } from './routes.js';
export {
  evaluateRule,
  evaluateAllRules,
  BUILTIN_RULES,
} from './rules/engine.js';
export { scoreConfidence, statusFromConfidence } from './confidence/score.js';
export { detectChangeEvents } from './temporal/compare.js';
export {
  scoreFrameBytes,
  selectFramesForAnalysis,
  hammingDistanceHex,
  perceptualHash,
  cosineSimilarity,
} from './quality/filter.js';
export { groupFramesIntoScenes, normalizeRoomType } from './scenes/group.js';
export {
  MockVisionAnalyzer,
  GeminiVisionAnalyzer,
  AnthropicVisionAnalyzer,
  UnconfiguredVisionAnalyzer,
  shouldEscalate,
  type VisionAnalyzer,
} from './ai/analyzer.js';
export {
  MockVerificationProvider,
  MockEscalationProvider,
  UnconfiguredVerificationProvider,
  createDefaultVerifier,
  shouldEscalateVerification,
  workEventVerificationResultSchema,
  type VerificationProvider,
  type WorkEventVerificationResult,
} from './ai/llmVerifier.js';
export {
  getVerificationCapabilities,
  resolveVisionAnalyzerMode,
  resolveLlmVerifierMode,
  type VerificationCapabilities,
} from './capabilities.js';
export {
  getProjectVerificationReport,
  getVideoProcessingStatus,
  groupTimelineByRoom,
} from './reporting/report.js';
export { linkOutcome } from './timeline/graph.js';
export { parseModelJson, frameObservationSchema } from './schemas.js';
export { VERIFIER_PROMPT_KEY, VERIFIER_PROMPT_VERSION, getPrompt } from './prompts/registry.js';
export {
  evaluateDatasetEligibility,
  type RightsManifestInput,
} from './dataset/eligibility.js';
export { scanTextForPrivacy, privacyStatusFromFindings } from './dataset/privacy.js';
export { assignSplit } from './dataset/splits.js';
export {
  createDatasetExampleFromResult,
  canonicalDatasetExampleSchema,
} from './dataset/examples.js';
export { exportDatasetVersionJsonl, assertNoSplitLeakage } from './dataset/exportJsonl.js';
