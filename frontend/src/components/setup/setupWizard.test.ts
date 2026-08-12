import { describe, expect, it } from 'vitest';
import { initialSetupStep, setupWizardCopy } from './setupWizard';

describe('setupWizardCopy', () => {
  it('keeps create-organization copy for a new company', () => {
    const copy = setupWizardCopy('create');
    expect(copy.heading).toBe('Create your organization');
    expect(copy.steps[1]?.title).toBe('Name your organization');
  });

  it('names the office-account link path', () => {
    const copy = setupWizardCopy('join');
    expect(copy.heading).toBe('Link to the office account');
    expect(copy.steps[1]?.title).toBe('Link to the office account');
    expect(copy.steps[1]?.detail).toMatch(/join code/i);
  });
});

describe('initialSetupStep', () => {
  it('starts at account creation for a new visitor', () => {
    expect(initialSetupStep({ user: false, membership: false, stepParam: null })).toBe(1);
  });

  it('skips to organization when the login already exists', () => {
    expect(initialSetupStep({ user: true, membership: false, stepParam: null })).toBe(2);
  });
});
