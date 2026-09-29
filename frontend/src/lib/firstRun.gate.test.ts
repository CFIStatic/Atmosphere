import { beforeEach, describe, expect, it } from 'vitest';
import { billingStepHref, firstRunDestination, readFirstRun, unpaidWorkspaceTarget, writeFirstRun } from './firstRun';

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

  it('after first evidence a generic landing returns from checkout to the first job, not Start a job', () => {
    const state = { evidenceSeen: true, jobId: 'job-1', jobTitle: 'Kitchen', jobNumber: 1 };
    const href = unpaidWorkspaceTarget(state, '/verifier-library');
    expect(href.startsWith('/signup?step=2&next=')).toBe(true);
    const next = decodeURIComponent(href.split('next=')[1] ?? '');
    expect(next).toBe('/job-progress?job=job-1&title=Kitchen&number=1');
    expect(firstRunDestination(next, '/verifier-library')).toBe(next);
    expect(firstRunDestination('/verifier-library', '/verifier-library', state)).toBe(next);
    expect(firstRunDestination('/intake', '/verifier-library', state)).toBe(next);
    // A specific deep link is kept.
    expect(unpaidWorkspaceTarget(state, '/settings?section=team')).toBe(
      '/signup?step=2&next=%2Fsettings%3Fsection%3Dteam',
    );
  });

  it('keeps progress per org', () => {
    writeFirstRun('org-1', { jobId: 'job-1' });
    writeFirstRun('org-1', { evidenceSeen: true });
    expect(readFirstRun('org-1')).toEqual({ jobId: 'job-1', evidenceSeen: true });
    expect(readFirstRun('org-2')).toEqual({});
  });
});
