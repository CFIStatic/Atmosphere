import { describe, expect, it } from 'vitest';
import { initialSetupStep, setupWizardCopy, workspaceNameFrom } from './setupWizard';

describe('setupWizardCopy', () => {
  it('uses ordinary create-an-account copy', () => {
    const copy = setupWizardCopy('create');
    expect(copy.heading).toBe('Create an account');
    expect(copy.steps[0]?.title).toBe('Create your account');
    expect(copy.steps[1]?.title).toBe('Your workspace');
  });

  it('keeps a join-code path without the two-card office wording', () => {
    const copy = setupWizardCopy('join');
    expect(copy.heading).toBe('Create an account');
    expect(copy.steps[1]?.title).toBe('Enter your join code');
    expect(copy.steps[1]?.detail).toMatch(/invite/i);
    expect(copy.heading).not.toMatch(/office account/i);
  });
});

describe('initialSetupStep', () => {
  it('starts at account creation for a new visitor', () => {
    expect(initialSetupStep({ user: false, membership: false, stepParam: null })).toBe(1);
  });

  it('skips to workspace setup when the login already exists', () => {
    expect(initialSetupStep({ user: true, membership: false, stepParam: null })).toBe(2);
  });
});

describe('workspaceNameFrom', () => {
  it('uses the person name when present', () => {
    expect(workspaceNameFrom('Dana Ortiz', 'dana@shop.example')).toBe('Dana Ortiz');
  });

  it('falls back to the email local part', () => {
    expect(workspaceNameFrom('', 'dana.ortiz@shop.example')).toBe("Dana Ortiz's workspace");
  });
});
