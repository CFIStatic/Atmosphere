/**
 * Verification rules engine — separate from the AI provider.
 *
 * The model provides observations. Rules decide whether evidence meets the
 * standard for verification. Rule versions are retained so historical reports
 * stay reproducible.
 */

import type { VerificationStatus } from '../types.js';
import { verificationConfig } from '../config.js';

export interface VerificationRule {
  id: string;
  activityType: string;
  version: string;
  name: string;
  requiredObservations: string[];
  requiredBeforeStates: string[];
  requiredAfterStates: string[];
  minSupportingFrames: number;
  minConfidence: number;
  contradictoryObservations: string[];
  allowedRoomTypes: string[];
  humanReviewTriggers: string[];
  projectRequirements?: Record<string, unknown>;
}

export interface RulesEvidence {
  activityType: string;
  roomType?: string | null;
  observations: string[];
  beforeStates: string[];
  afterStates: string[];
  supportingFrameCount: number;
  confidence: number;
  contradictory: string[];
  highValueClaim?: boolean;
  safetyIssues?: string[];
}

export interface RulesResult {
  activityType: string;
  ruleId: string | null;
  ruleVersion: string | null;
  status: VerificationStatus;
  passed: boolean;
  missing: string[];
  triggersReview: boolean;
  reviewReasons: string[];
  detail: string;
}

export function evaluateRule(rule: VerificationRule, evidence: RulesEvidence): RulesResult {
  const missing: string[] = [];
  const reviewReasons: string[] = [];

  if (
    rule.allowedRoomTypes.length > 0 &&
    evidence.roomType &&
    !rule.allowedRoomTypes.includes(evidence.roomType)
  ) {
    return {
      activityType: rule.activityType,
      ruleId: rule.id,
      ruleVersion: rule.version,
      status: 'rejected',
      passed: false,
      missing: [`room_type:${evidence.roomType}`],
      triggersReview: false,
      reviewReasons: [],
      detail: `Room type ${evidence.roomType} is not allowed for this rule`,
    };
  }

  for (const req of rule.requiredBeforeStates) {
    if (!evidence.beforeStates.includes(req) && !evidence.observations.includes(req)) {
      missing.push(`before:${req}`);
    }
  }
  for (const req of rule.requiredAfterStates) {
    if (!evidence.afterStates.includes(req) && !evidence.observations.includes(req)) {
      missing.push(`after:${req}`);
    }
  }
  for (const req of rule.requiredObservations) {
    if (
      !evidence.observations.includes(req) &&
      !evidence.beforeStates.includes(req) &&
      !evidence.afterStates.includes(req)
    ) {
      // Required observations may be satisfied by before+after combo pieces
      const satisfiedByStates =
        (rule.requiredBeforeStates.length === 0 ||
          rule.requiredBeforeStates.some((s) => evidence.beforeStates.includes(s))) &&
        (rule.requiredAfterStates.length === 0 ||
          rule.requiredAfterStates.some((s) => evidence.afterStates.includes(s)));
      if (!satisfiedByStates) missing.push(`obs:${req}`);
    }
  }

  const contradictions = evidence.contradictory.filter((c) =>
    rule.contradictoryObservations.includes(c),
  );
  // Also treat free-form conflicting markers
  const hasConflict =
    contradictions.length > 0 ||
    evidence.contradictory.some((c) => c.includes('contradict'));

  if (evidence.supportingFrameCount < rule.minSupportingFrames) {
    missing.push(`frames:${evidence.supportingFrameCount}<${rule.minSupportingFrames}`);
  }
  if (evidence.confidence < rule.minConfidence) {
    missing.push(`confidence:${evidence.confidence}<${rule.minConfidence}`);
  }

  for (const trigger of rule.humanReviewTriggers) {
    if (trigger === 'missing_before' && missing.some((m) => m.startsWith('before:'))) {
      reviewReasons.push(trigger);
    }
    if (trigger === 'missing_after' && missing.some((m) => m.startsWith('after:'))) {
      reviewReasons.push(trigger);
    }
    if (trigger === 'low_confidence' && evidence.confidence < rule.minConfidence) {
      reviewReasons.push(trigger);
    }
    if (trigger === 'contradiction' && hasConflict) {
      reviewReasons.push(trigger);
    }
    if (trigger === 'safety_issue' && (evidence.safetyIssues?.length ?? 0) > 0) {
      reviewReasons.push(trigger);
    }
    if (trigger === 'high_value_claim' && evidence.highValueClaim) {
      reviewReasons.push(trigger);
    }
  }

  let status: VerificationStatus = 'uncertain';
  if (hasConflict) status = 'contradicted';
  else if (missing.length === 0 && evidence.confidence >= verificationConfig.verifiedThreshold) {
    status = 'verified';
  } else if (missing.length === 0 && evidence.confidence >= verificationConfig.likelyVerifiedThreshold) {
    status = 'likely_verified';
  } else if (missing.some((m) => m.startsWith('before:') || m.startsWith('after:'))) {
    status = 'uncertain';
  } else if (missing.length > 0) {
    status = 'uncertain';
  }

  const triggersReview =
    reviewReasons.length > 0 ||
    status === 'contradicted' ||
    status === 'uncertain' && missing.length > 0;

  if (triggersReview && (status === 'verified' || status === 'likely_verified')) {
    status = 'needs_review';
  }

  return {
    activityType: rule.activityType,
    ruleId: rule.id,
    ruleVersion: rule.version,
    status,
    passed: missing.length === 0 && !hasConflict,
    missing,
    triggersReview,
    reviewReasons,
    detail: hasConflict
      ? 'Contradictory evidence present'
      : missing.length
        ? `Missing: ${missing.join(', ')}`
        : 'Evidence meets rule requirements',
  };
}

export function evaluateAllRules(
  rules: VerificationRule[],
  evidence: RulesEvidence,
): RulesResult | null {
  const rule = rules.find((r) => r.activityType === evidence.activityType);
  if (!rule) {
    return {
      activityType: evidence.activityType,
      ruleId: null,
      ruleVersion: null,
      status: 'uncertain',
      passed: false,
      missing: ['no_rule'],
      triggersReview: true,
      reviewReasons: ['unsupported_ai_claim'],
      detail: 'No verification rule registered for this activity',
    };
  }
  return evaluateRule(rule, evidence);
}

/** Built-in defaults used when DB seed is unavailable (tests / offline). */
export const BUILTIN_RULES: VerificationRule[] = [
  {
    id: 'builtin-drywall-removed',
    activityType: 'drywall_removed',
    version: 'v1',
    name: 'Drywall removal',
    requiredObservations: ['drywall_visible', 'exposed_studs'],
    requiredBeforeStates: ['drywall_present'],
    requiredAfterStates: ['framing_exposed', 'drywall_removed'],
    minSupportingFrames: 2,
    minConfidence: 0.75,
    contradictoryObservations: ['drywall_intact_later'],
    allowedRoomTypes: [],
    humanReviewTriggers: ['missing_before', 'missing_after', 'low_confidence', 'contradiction'],
  },
  {
    id: 'builtin-insulation-installed',
    activityType: 'insulation_installed',
    version: 'v1',
    name: 'Insulation installation',
    requiredObservations: ['cavity_exposed', 'insulation_present'],
    requiredBeforeStates: ['framing_exposed', 'cavity_empty'],
    requiredAfterStates: ['insulation_installed', 'insulation_present'],
    minSupportingFrames: 2,
    minConfidence: 0.7,
    contradictoryObservations: ['cavity_still_empty'],
    allowedRoomTypes: [],
    humanReviewTriggers: ['missing_before', 'low_confidence'],
  },
  {
    id: 'builtin-drywall-installed',
    activityType: 'drywall_installed',
    version: 'v1',
    name: 'Drywall installation',
    requiredObservations: ['framing_exposed', 'drywall_hung'],
    requiredBeforeStates: ['framing_exposed', 'insulation_present'],
    requiredAfterStates: ['drywall_installed', 'drywall_present'],
    minSupportingFrames: 2,
    minConfidence: 0.75,
    contradictoryObservations: ['framing_still_exposed'],
    allowedRoomTypes: [],
    humanReviewTriggers: ['missing_before', 'contradiction'],
  },
];
