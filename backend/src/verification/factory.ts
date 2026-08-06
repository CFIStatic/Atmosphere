/**
 * Wire default pipeline handlers into a ProcessingOrchestrator.
 */

import { ProcessingOrchestrator } from './pipeline/orchestrator.js';
import {
  createExtractFramesHandler,
  createExtractMetadataHandler,
  downloadVideoToTemp,
  probeMetadata,
  defaultRunner,
} from './frames/extract.js';
import { createClipsForChangeEvents } from './frames/clips.js';
import {
  createDeduplicateFramesHandler,
  createScoreFrameQualityHandler,
} from './quality/filter.js';
import { createClassifyScenesHandler } from './scenes/group.js';
import {
  createAnalyzeFramesHandler,
  GeminiVisionAnalyzer,
  MockVisionAnalyzer,
  type VisionAnalyzer,
} from './ai/analyzer.js';
import {
  createDefaultEscalationVerifier,
  createDefaultVerifier,
  createLlmVerifyEvidenceHandler,
  type EscalationVerificationProvider,
  type VerificationProvider,
} from './ai/llmVerifier.js';
import { createCompareTimelineHandler } from './temporal/compare.js';
import {
  createCalculateConfidenceHandler,
  createFinalizeReportHandler,
  createGenerateVerificationsHandler,
} from './pipeline/handlers.js';
import {
  createGenerateVerifiedEventsHandler,
  createUpdateProjectGraphHandler,
} from './timeline/graph.js';
import { verificationConfig } from './config.js';
import type { PipelineContext } from './pipeline/orchestrator.js';

async function loadFrameBytes(ctx: PipelineContext, storagePath: string): Promise<Buffer> {
  const { data, error } = await ctx.supabase.storage
    .from(verificationConfig.bucket)
    .download(storagePath);
  if (error || !data) throw new Error(error?.message ?? 'Frame download failed');
  return Buffer.from(await data.arrayBuffer());
}

async function loadFrameBase64(ctx: PipelineContext, storagePath: string): Promise<string> {
  return (await loadFrameBytes(ctx, storagePath)).toString('base64');
}

export function createDefaultAnalyzer(): VisionAnalyzer {
  if (process.env.VERIFICATION_USE_MOCK_AI === 'true') {
    return new MockVisionAnalyzer();
  }
  const hasGoogle = Boolean(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY);
  if (hasGoogle) return new GeminiVisionAnalyzer();
  if (process.env.NODE_ENV === 'test' || process.env.VERIFICATION_ALLOW_MOCK_FALLBACK === 'true') {
    return new MockVisionAnalyzer();
  }
  return new GeminiVisionAnalyzer();
}

export function createVerificationOrchestrator(opts?: {
  analyzer?: VisionAnalyzer;
  verifier?: VerificationProvider;
  escalation?: EscalationVerificationProvider;
  delaysMs?: number[];
}): ProcessingOrchestrator {
  const analyzer = opts?.analyzer ?? createDefaultAnalyzer();
  const verifier = opts?.verifier ?? createDefaultVerifier();
  const escalation = opts?.escalation ?? createDefaultEscalationVerifier();

  return new ProcessingOrchestrator({
    delaysMs: opts?.delaysMs,
    handlers: {
      validate_video: async (ctx) => {
        const localPath =
          (ctx.config._localVideoPath as string | undefined) ?? (await downloadVideoToTemp(ctx));
        const meta = await probeMetadata(localPath, defaultRunner);
        if (meta.durationSeconds != null) {
          if (meta.durationSeconds < verificationConfig.minDurationSeconds) {
            throw new Error(`Video too short (${meta.durationSeconds}s)`);
          }
          if (meta.durationSeconds > verificationConfig.maxDurationSeconds) {
            throw new Error(`Video too long (${meta.durationSeconds}s)`);
          }
        }
        return { output: { valid: true, metadata: meta } };
      },
      extract_metadata: createExtractMetadataHandler(),
      // Processing copy placeholder — originals stay untouched in storage.
      transcode_video: async () => ({
        output: { skipped: true, reason: 'original_preserved_transcode_optional' },
        skip: true,
      }),
      extract_frames: createExtractFramesHandler(),
      score_frame_quality: createScoreFrameQualityHandler({ loadFrameBytes }),
      deduplicate_frames: createDeduplicateFramesHandler(),
      classify_scenes: createClassifyScenesHandler(),
      analyze_frames: createAnalyzeFramesHandler({ analyzer, loadFrameBase64 }),
      compare_timeline: async (ctx) => {
        const result = await createCompareTimelineHandler()(ctx);
        const clips = await createClipsForChangeEvents(ctx);
        return { output: { ...result.output, clips } };
      },
      llm_verify_evidence: createLlmVerifyEvidenceHandler({ verifier, escalation }),
      generate_verifications: createGenerateVerificationsHandler(),
      generate_verified_events: createGenerateVerifiedEventsHandler(),
      update_project_graph: createUpdateProjectGraphHandler(),
      calculate_confidence: createCalculateConfidenceHandler(),
      finalize_report: createFinalizeReportHandler(),
    },
  });
}

/** Process-wide singleton used by routes. */
let singleton: ProcessingOrchestrator | null = null;

export function getVerificationOrchestrator(): ProcessingOrchestrator {
  if (!singleton) singleton = createVerificationOrchestrator();
  return singleton;
}

export function setVerificationOrchestratorForTests(orch: ProcessingOrchestrator | null): void {
  singleton = orch;
}
