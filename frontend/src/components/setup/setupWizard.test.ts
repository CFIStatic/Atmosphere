import { describe, expect, it } from 'vitest';
import { initialSetupStep, setupWizardCopy, workspaceNameFrom } from './setupWizard';

describe('setupWizardCopy', () => {
  it('uses Global Admin create-company copy', () => {
    const copy = setupWizardCopy('create');
    expect(copy.heading).toBe('Create your company');
    expect(copy.steps.map((s) => s.title)).toEqual([
      'Create your account',
      'Your workspace',
      'Set up billing',
    ]);
    expect(copy.lede).toMatch(/Global Admin/i);
    expect(copy.steps[0]?.detail).toMatch(/name, email, and a password/i);
    expect(copy.steps[0]?.detail).not.toMatch(/join code/i);
    expect(copy.steps[1]?.detail).toMatch(/name the company/i);
    expect(copy.steps[1]?.detail).not.toMatch(/company type/i);
    expect(copy.steps[1]?.detail).toMatch(/Global Admin/i);
  });

  it('keeps an invite-only join path', () => {
    const copy = setupWizardCopy('join');
    expect(copy.heading).toBe('Join your team');
    expect(copy.steps.map((s) => s.title)).toEqual([
      'Create your account',
      'Enter your join code',
      'Set up billing',
    ]);
    expect(copy.steps[1]?.detail).toMatch(/invite/i);
    expect(copy.lede).toMatch(/Global Admin invited/i);
  });
});

describe('initialSetupStep', () => {
  it('starts at account creation for a new visitor', () => {
    expect(initialSetupStep({ user: false, membership: false, stepParam: null })).toBe(1);
  });

  it('skips to workspace setup when the login already exists', () => {
    expect(initialSetupStep({ user: true, membership: false, stepParam: null })).toBe(2);
  });

  it('maps legacy invite and billing step numbers to billing', () => {
    expect(initialSetupStep({ user: true, membership: true, stepParam: '5' })).toBe(3);
    expect(initialSetupStep({ user: true, membership: true, stepParam: '4' })).toBe(3);
    expect(initialSetupStep({ user: true, membership: true, stepParam: '3' })).toBe(3);
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
