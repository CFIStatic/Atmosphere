/**
 * Observation vs inference vs verified. Unknown is not pass.
 * AI analysis cannot become verified.
 */

export type SourceType = 'observation' | 'inference' | 'verified';
export type VerificationStatus =
  | 'unknown'
  | 'observed'
  | 'inferred'
  | 'verified'
  | 'rejected'
  | 'needs_review';

export function applyVerificationEvent(input: {
  current: VerificationStatus;
  sourceType: SourceType;
  result?: 'pass' | 'fail' | 'inconclusive' | 'unknown';
}): VerificationStatus {
  if (input.sourceType === 'verified') {
    if (input.result === 'fail') return 'rejected';
    if (input.result === 'inconclusive' || input.result === 'unknown') return 'needs_review';
    return 'verified';
  }
  if (input.sourceType === 'inference') {
    return input.current === 'unknown' ? 'inferred' : input.current;
  }
  if (input.current === 'unknown' || input.current === 'inferred') return 'observed';
  return input.current;
}

export function unknownIsNotPass(status: VerificationStatus): boolean {
  return status !== 'verified';
}

export function statusFromTierAndVerifications(input: {
  tier: number;
  verifications: Array<{ kind?: string; result?: string }>;
}): VerificationStatus {
  const human = input.verifications.filter((row) => row.kind && row.kind !== 'ai_analysis');
  if (human.some((row) => row.result === 'fail')) return 'rejected';
  if (human.some((row) => row.result === 'pass')) return 'verified';
  if (human.some((row) => row.result === 'inconclusive')) return 'needs_review';
  if (input.verifications.some((row) => row.kind === 'ai_analysis')) return 'inferred';
  if (input.tier >= 2) return 'observed';
  return 'unknown';
}
