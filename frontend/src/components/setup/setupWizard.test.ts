import { describe, expect, it } from 'vitest';
import { initialSetupStep, setupWizardCopy, workspaceNameFrom } from './setupWizard';

describe('setupWizardCopy', () => {
  it('uses short create-an-account steps', () => {
    const copy = setupWizardCopy('create');
    expect(copy.heading).toBe('Create an account');
    expect(copy.steps.map((s) => s.title)).toEqual(['Account', 'Company', 'Payment', 'Invite team']);
    expect(copy.lede).toMatch(/payment, then invite/i);
  });

  it('keeps a join path without office-account wording', () => {
    const copy = setupWizardCopy('join');
    expect(copy.heading).toBe('Join your team');
    expect(copy.steps.map((s) => s.title)).toEqual(['Account', 'Join team']);
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

  it('maps the legacy billing step number to billing', () => {
    expect(initialSetupStep({ user: true, membership: true, stepParam: '5' })).toBe(3);
    expect(initialSetupStep({ user: true, membership: true, stepParam: '3' })).toBe(3);
    expect(initialSetupStep({ user: true, membership: true, stepParam: '4' })).toBe(4);
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
