/**
 * Deployment readiness for AI video analysis.
 *
 * The office UI and operators use this to see whether real model keys and
 * FFmpeg are wired — without ever reading key material back. Mock mode is
 * reported plainly so a demo deploy cannot be mistaken for live analysis.
 */

import { spawnSync } from 'node:child_process';
import { verificationConfig } from './config.js';
import {
  getVideoRoutingPlan,
  hasAnyVideoProvider,
  type VideoProviderId,
  type VideoRoutingPlan,
} from './ai/router.js';

export type AnalyzerMode = 'routed' | 'mock' | 'unconfigured';
export type VerifierMode = 'routed' | 'mock' | 'unconfigured';

export interface VerificationCapabilities {
  /** True when proof narration + deep pipeline can run without mock AI. */
  ready: boolean;
  mockForced: boolean;
  mockFallbackAllowed: boolean;
  proofNarration: {
    configured: boolean;
    provider: VideoProviderId | null;
    model: string | null;
    detail: string;
  };
  visionAnalyzer: {
    mode: AnalyzerMode;
    model: string | null;
    provider: VideoProviderId | null;
    detail: string;
  };
  llmVerifier: {
    mode: VerifierMode;
    model: string | null;
    provider: VideoProviderId | null;
    detail: string;
  };
  /** Cost-aware route table for the five video tasks. */
  routing: VideoRoutingPlan;
  ffmpeg: {
    available: boolean;
    path: string;
    detail: string;
  };
  pipelineFromProof: boolean;
  keys: {
    anthropic: boolean;
    google: boolean;
    openai: boolean;
    xai: boolean;
  };
  /** Env vars an operator should set — names only, never values. */
  requiredEnv: Array<{ name: string; purpose: string; set: boolean }>;
}

function mockForced(): boolean {
  return process.env.VERIFICATION_USE_MOCK_AI === 'true';
}

function mockFallbackAllowed(): boolean {
  return (
    process.env.VERIFICATION_ALLOW_MOCK_FALLBACK === 'true' ||
    process.env.NODE_ENV === 'test'
  );
}

export function resolveVisionAnalyzerMode(): AnalyzerMode {
  if (mockForced()) return 'mock';
  if (hasAnyVideoProvider()) return 'routed';
  if (mockFallbackAllowed()) return 'mock';
  return 'unconfigured';
}

export function resolveLlmVerifierMode(): VerifierMode {
  if (mockForced() || process.env.NODE_ENV === 'test') return 'mock';
  if (hasAnyVideoProvider()) return 'routed';
  if (mockFallbackAllowed()) return 'mock';
  return 'unconfigured';
}

function probeBinary(bin: string): boolean {
  try {
    const result = spawnSync(bin, ['-version'], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

export function getVerificationCapabilities(): VerificationCapabilities {
  const routing = getVideoRoutingPlan();
  const keys = {
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    google: Boolean(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
    xai: Boolean(process.env.XAI_API_KEY),
  };
  const visionMode = resolveVisionAnalyzerMode();
  const verifierMode = resolveLlmVerifierMode();
  const ffmpegOk = probeBinary(verificationConfig.ffmpegPath);
  const ffprobeOk = probeBinary(verificationConfig.ffprobePath);
  const ffmpegAvailable = ffmpegOk && ffprobeOk;

  const proofRoute = routing.proofNarration;
  const visionRoute = routing.frameObservation;
  const verifyRoute = routing.llmVerify;

  const ready =
    !mockForced() &&
    visionMode === 'routed' &&
    verifierMode === 'routed' &&
    Boolean(proofRoute) &&
    ffmpegAvailable;

  return {
    ready,
    mockForced: mockForced(),
    mockFallbackAllowed: mockFallbackAllowed(),
    proofNarration: {
      configured: Boolean(proofRoute),
      provider: proofRoute?.provider ?? null,
      model: proofRoute?.model ?? null,
      detail: proofRoute
        ? `Narration routes to ${proofRoute.provider}/${proofRoute.model} (${proofRoute.tier}).`
        : 'Set at least one of ANTHROPIC_API_KEY, GOOGLE_API_KEY, OPENAI_API_KEY, XAI_API_KEY.',
    },
    visionAnalyzer: {
      mode: visionMode,
      model: visionRoute?.model ?? (visionMode === 'mock' ? 'mock-vision' : null),
      provider: visionRoute?.provider ?? null,
      detail:
        visionMode === 'routed' && visionRoute
          ? `Bulk frames → ${visionRoute.provider}/${visionRoute.model}. Escalation → ${routing.frameEscalation?.provider}/${routing.frameEscalation?.model}.`
          : visionMode === 'mock'
            ? 'Mock vision is active — results are fixtures, not model reads.'
            : 'Set GOOGLE_API_KEY (cheapest), OPENAI_API_KEY, XAI_API_KEY, or ANTHROPIC_API_KEY.',
    },
    llmVerifier: {
      mode: verifierMode,
      model: verifyRoute?.model ?? (verifierMode === 'mock' ? 'mock-verifier' : null),
      provider: verifyRoute?.provider ?? null,
      detail:
        verifierMode === 'routed' && verifyRoute
          ? `Bulk verify → ${verifyRoute.provider}/${verifyRoute.model}. Disputes → ${routing.llmEscalate?.provider}/${routing.llmEscalate?.model}.`
          : verifierMode === 'mock'
            ? 'Mock verifier is active — decisions are not model-backed.'
            : 'Set at least one model API key for the LLM verifier.',
    },
    routing,
    ffmpeg: {
      available: ffmpegAvailable,
      path: verificationConfig.ffmpegPath,
      detail: ffmpegAvailable
        ? 'FFmpeg can extract frames from uploaded video.'
        : `Install FFmpeg on the worker host (looked for ${verificationConfig.ffmpegPath} / ${verificationConfig.ffprobePath}).`,
    },
    pipelineFromProof: process.env.VERIFICATION_PIPELINE_FROM_PROOF !== 'false',
    keys,
    requiredEnv: [
      {
        name: 'GOOGLE_API_KEY',
        purpose: 'Cheapest frame observations (Gemini Flash) — preferred for bulk vision',
        set: keys.google,
      },
      {
        name: 'OPENAI_API_KEY',
        purpose: 'OpenAI mini / flagship vision + verify arms',
        set: keys.openai,
      },
      {
        name: 'XAI_API_KEY',
        purpose: 'Grok fast / flagship arms',
        set: keys.xai,
      },
      {
        name: 'ANTHROPIC_API_KEY',
        purpose: 'Narration + escalation / dispute verifier (accuracy path)',
        set: keys.anthropic,
      },
      {
        name: 'FFMPEG_PATH',
        purpose: 'Server-side frame extraction for long / frame-less uploads',
        set: ffmpegOk,
      },
    ],
  };
}
