/**
 * System confidence scoring.
 *
 * Model confidence is an input, never the final score.
 */

import type { ConfidenceBreakdown, VerificationStatus } from '../types.js';
import { verificationConfig } from '../config.js';
import type { RulesResult } from '../rules/engine.js';

export interface ConfidenceInputs {
  modelConfidence: number;
  supportingFrameCount: number;
  /** Average quality of supporting frames, 0–1. */
  visualQuality: number;
  /** How consistent the timeline is, 0–1. */
  temporalConsistency: number;
  /** Scene/room match confidence, 0–1. */
  sceneMatchConfidence: number;
  /** Agreement between model calls, 0–1 (1 = full agreement). */
  modelAgreement: number;
  rulesResult: RulesResult | null;
  hasContradictoryEvidence: boolean;
  /** GPS / capture metadata completeness, 0–1. */
  metadataQuality: number;
  /** 1 if human confirmed, 0 otherwise. */
  humanConfirmation: number;
}

export function scoreConfidence(input: ConfidenceInputs): ConfidenceBreakdown {
  const frameFactor = Math.min(1, input.supportingFrameCount / 3);
  const rulesEngineScore = !input.rulesResult
    ? 0.4
    : input.rulesResult.passed
      ? 1
      : input.rulesResult.status === 'contradicted'
        ? 0
        : 0.35;
  const contradictionPenalty = input.hasContradictoryEvidence ? 0.35 : 0;

  const weighted =
    input.modelConfidence * 0.18 +
    frameFactor * 0.14 +
    input.visualQuality * 0.1 +
    input.temporalConsistency * 0.14 +
    input.sceneMatchConfidence * 0.1 +
    input.modelAgreement * 0.1 +
    rulesEngineScore * 0.16 +
    input.metadataQuality * 0.04 +
    input.humanConfirmation * 0.14 -
    contradictionPenalty;

  const final = Number(Math.max(0, Math.min(1, weighted)).toFixed(4));

  return {
    modelConfidence: clamp01(input.modelConfidence),
    supportingFrameCount: input.supportingFrameCount,
    visualQuality: clamp01(input.visualQuality),
    temporalConsistency: clamp01(input.temporalConsistency),
    sceneMatchConfidence: clamp01(input.sceneMatchConfidence),
    modelAgreement: clamp01(input.modelAgreement),
    rulesEngineScore,
    contradictionPenalty,
    metadataQuality: clamp01(input.metadataQuality),
    humanConfirmation: clamp01(input.humanConfirmation),
    final,
  };
}

function clamp01(n: number): number {
  return Number(Math.max(0, Math.min(1, n)).toFixed(4));
}

export function statusFromConfidence(
  breakdown: ConfidenceBreakdown,
  rulesStatus: VerificationStatus | null,
  opts?: { humanVerified?: boolean },
): VerificationStatus {
  if (opts?.humanVerified) return 'human_verified';
  if (rulesStatus === 'contradicted') return 'contradicted';
  if (rulesStatus === 'rejected') return 'rejected';
  if (rulesStatus === 'needs_review') return 'needs_review';
  if (breakdown.final >= verificationConfig.verifiedThreshold && rulesStatus === 'verified') {
    return 'verified';
  }
  if (breakdown.final >= verificationConfig.likelyVerifiedThreshold) {
    return rulesStatus === 'verified' || rulesStatus === 'likely_verified'
      ? 'likely_verified'
      : 'likely_verified';
  }
  if (breakdown.final < verificationConfig.escalateBelowConfidence) return 'needs_review';
  return 'uncertain';
}
