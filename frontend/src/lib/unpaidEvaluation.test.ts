import { describe, expect, it } from 'vitest';
import { isUnpaidEvaluationLocation } from './unpaidEvaluation';

describe('unpaid evaluation routes', () => {
  it('opens the job file, welcome, and the organization invite panel', () => {
    expect(isUnpaidEvaluationLocation('/job-progress', '?job=job-1')).toBe(true);
    expect(isUnpaidEvaluationLocation('/welcome')).toBe(true);
    expect(isUnpaidEvaluationLocation('/jobs/job-1')).toBe(true);
    expect(isUnpaidEvaluationLocation('/settings', '?section=organization')).toBe(true);
  });

  it('still sends the rest of the office to plan selection', () => {
    expect(isUnpaidEvaluationLocation('/verifier-library')).toBe(false);
    expect(isUnpaidEvaluationLocation('/settings', '?section=billing')).toBe(false);
    expect(isUnpaidEvaluationLocation('/settings', '')).toBe(false);
    expect(isUnpaidEvaluationLocation('/intake')).toBe(false);
  });
});
