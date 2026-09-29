import { beforeEach, describe, expect, it } from 'vitest';
import { billingStepHref, readFirstRun, unpaidWorkspaceTarget, writeFirstRun } from './firstRun';

describe('first run gate (value before payment)', () => {
  beforeEach(() => localStorage.clear());

  it('an unpaid workspace without first evidence goes to the welcome page', () => {
    expect(unpaidWorkspaceTarget({}, '/verifier-library')).toBe('/welcome?next=%2Fverifier-library');
  });

  it('after first evidence it goes to plan and card on the Stripe-compatible step=2 URL', () => {
    expect(unpaidWorkspaceTarget({ evidenceSeen: true }, '/verifier-library')).toBe(
      '/signup?step=2&next=%2Fverifier-library',
    );
    expect(billingStepHref(null)).toBe('/signup?step=2');
  });

  it('keeps progress per org', () => {
    writeFirstRun('org-1', { jobId: 'job-1' });
    writeFirstRun('org-1', { evidenceSeen: true });
    expect(readFirstRun('org-1')).toEqual({ jobId: 'job-1', evidenceSeen: true });
    expect(readFirstRun('org-2')).toEqual({});
  });
});
