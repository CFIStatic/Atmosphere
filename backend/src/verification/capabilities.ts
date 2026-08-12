/**
 * Deployment readiness for AI video analysis.
 *
 * The office UI and operators use this to see whether real model keys and
 * FFmpeg are wired — without ever reading key material back. Mock mode is
 * reported plainly so a demo deploy cannot be mistaken for live analysis.
 */

import { spawnSync } from 'node:child_process';
import { isModelProviderConfigured } from '../lib/anthropic.js';
import { verificationConfig } from './config.js';

export type AnalyzerMode = 'gemini' | 'anthropic' | 'mock' | 'unconfigured';
export type VerifierMode = 'anthropic' | 'google' | 'mock' | 'unconfigured';

export interface VerificationCapabilities {
  /** True when proof narration + deep pipeline can run without mock AI. */
  ready: boolean;
  mockForced: boolean;
  mockFallbackAllowed: boolean;
  proofNarration: {
    configured: boolean;
    provider: 'anthropic' | null;
    detail: string;
  };
  visionAnalyzer: {
    mode: AnalyzerMode;
    model: string | null;
    detail: string;
  };
  llmVerifier: {
    mode: VerifierMode;
    model: string | null;
    detail: string;
  };
  ffmpeg: {
    available: boolean;
    path: string;
    detail: string;
  };
  pipelineFromProof: boolean;
  keys: {
    anthropic: boolean;
    google: boolean;
  };
  /** Env vars an operator should set — names only, never values. */
  requiredEnv: Array<{ name: string; purpose: string; set: boolean }>;
}

function hasGoogleKey(): boolean {
  return Boolean(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY);
}

function hasAnthropicKey(): boolean {
  return isModelProviderConfigured() || Boolean(process.env.ANTHROPIC_API_KEY);
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
  if (hasGoogleKey()) return 'gemini';
  if (hasAnthropicKey()) return 'anthropic';
  if (mockFallbackAllowed()) return 'mock';
  return 'unconfigured';
}

export function resolveLlmVerifierMode(): VerifierMode {
  if (mockForced() || process.env.NODE_ENV === 'test') return 'mock';
  if (hasAnthropicKey()) return 'anthropic';
  if (hasGoogleKey()) return 'google';
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
  const anthropic = hasAnthropicKey();
  const google = hasGoogleKey();
  const visionMode = resolveVisionAnalyzerMode();
  const verifierMode = resolveLlmVerifierMode();
  const ffmpegOk = probeBinary(verificationConfig.ffmpegPath);
  const ffprobeOk = probeBinary(verificationConfig.ffprobePath);
  const ffmpegAvailable = ffmpegOk && ffprobeOk;

  const proofConfigured = anthropic;
  const realVision = visionMode === 'gemini' || visionMode === 'anthropic';
  const realVerifier = verifierMode === 'anthropic' || verifierMode === 'google';
  const ready =
    !mockForced() &&
    proofConfigured &&
    realVision &&
    realVerifier &&
    ffmpegAvailable;

  const visionModel =
    visionMode === 'gemini'
      ? verificationConfig.primaryModel
      : visionMode === 'anthropic'
        ? verificationConfig.escalationModel
        : visionMode === 'mock'
          ? 'mock-vision'
          : null;

  const verifierModel =
    verifierMode === 'anthropic'
      ? process.env.VERIFICATION_LLM_VERIFIER_MODEL ?? verificationConfig.escalationModel
      : verifierMode === 'google'
        ? process.env.VERIFICATION_LLM_VERIFIER_MODEL ?? verificationConfig.primaryModel
        : verifierMode === 'mock'
          ? 'mock-verifier'
          : null;

  return {
    ready,
    mockForced: mockForced(),
    mockFallbackAllowed: mockFallbackAllowed(),
    proofNarration: {
      configured: proofConfigured,
      provider: proofConfigured ? 'anthropic' : null,
      detail: proofConfigured
        ? 'Anthropic will narrate filed clips and compare before/after days.'
        : 'Set ANTHROPIC_API_KEY so the office can read filed videos.',
    },
    visionAnalyzer: {
      mode: visionMode,
      model: visionModel,
      detail:
        visionMode === 'gemini'
          ? 'Gemini Flash reads frames for the deep verification pipeline.'
          : visionMode === 'anthropic'
            ? 'Anthropic vision is the frame reader (no Gemini key set).'
            : visionMode === 'mock'
              ? 'Mock vision is active — results are fixtures, not model reads.'
              : 'Set GOOGLE_API_KEY (or GEMINI_API_KEY), or ANTHROPIC_API_KEY for vision.',
    },
    llmVerifier: {
      mode: verifierMode,
      model: verifierModel,
      detail:
        verifierMode === 'anthropic'
          ? 'Anthropic is the primary work-event verifier.'
          : verifierMode === 'google'
            ? 'Gemini is verifying work events (no Anthropic key).'
            : verifierMode === 'mock'
              ? 'Mock verifier is active — decisions are not model-backed.'
              : 'Set ANTHROPIC_API_KEY (preferred) or GOOGLE_API_KEY for the LLM verifier.',
    },
    ffmpeg: {
      available: ffmpegAvailable,
      path: verificationConfig.ffmpegPath,
      detail: ffmpegAvailable
        ? 'FFmpeg can extract frames from uploaded video.'
        : `Install FFmpeg on the worker host (looked for ${verificationConfig.ffmpegPath} / ${verificationConfig.ffprobePath}).`,
    },
    pipelineFromProof: process.env.VERIFICATION_PIPELINE_FROM_PROOF !== 'false',
    keys: { anthropic, google },
    requiredEnv: [
      {
        name: 'ANTHROPIC_API_KEY',
        purpose: 'Proof narration, day comparison, LLM verifier (and vision fallback)',
        set: anthropic,
      },
      {
        name: 'GOOGLE_API_KEY',
        purpose: 'Primary low-cost Gemini frame observations (or use GEMINI_API_KEY)',
        set: google,
      },
      {
        name: 'FFMPEG_PATH',
        purpose: 'Server-side frame extraction for long / frame-less uploads',
        set: ffmpegOk,
      },
    ],
  };
}
