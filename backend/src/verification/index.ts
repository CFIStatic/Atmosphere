/**
 * Video work-verification pipeline.
 *
 * Extends the existing proof-of-work media layer (`job_proofs`) with a durable
 * multi-stage analysis pipeline: ingestion → FFmpeg frames → quality/dedup →
 * scenes → AI observations → temporal comparison → rules → confidence →
 * human review → reporting.
 *
 * Entry points:
 *   - HTTP: `verificationRouter` mounted at `/api/verification`
 *   - Programmatic: `getVerificationOrchestrator().enqueue(...)`
 *   - From proof uploads: `linkProofAsVerificationVideo` + enqueue
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
  shouldEscalate,
  type VisionAnalyzer,
} from './ai/analyzer.js';
export {
  getProjectVerificationReport,
  getVideoProcessingStatus,
  groupTimelineByRoom,
} from './reporting/report.js';
export { parseModelJson, frameObservationSchema } from './schemas.js';
