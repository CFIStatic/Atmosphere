import { describe, expect, it } from 'vitest';
import { initialSetupStep, setupWizardCopy, workspaceNameFrom } from './setupWizard';

describe('setupWizardCopy', () => {
  it('uses Global Admin create-company copy', () => {
    const copy = setupWizardCopy('create');
    expect(copy.heading).toBe('Create your company');
    expect(copy.steps.map((s) => s.title)).toEqual(['Account & workspace', 'Set up billing']);
    expect(copy.lede).toMatch(/Global Admin/i);
    expect(copy.steps[0]?.detail).toMatch(/login and company name/i);
    expect(copy.steps[0]?.detail).not.toMatch(/join code/i);
    expect(copy.steps[0]?.detail).not.toMatch(/company type/i);
    expect(copy.steps[0]?.detail).toMatch(/Global Admin/i);
  });

  it('keeps an invite-only join path', () => {
    const copy = setupWizardCopy('join');
    expect(copy.heading).toBe('Join your team');
    expect(copy.steps.map((s) => s.title)).toEqual(['Account & join code', 'Set up billing']);
    expect(copy.steps[0]?.detail).toMatch(/join code/i);
    expect(copy.lede).toMatch(/Global Admin invited/i);
  });
});

describe('initialSetupStep', () => {
  it('starts at the combined account and workspace form', () => {
    expect(initialSetupStep({ user: false, membership: false, stepParam: null })).toBe(1);
    expect(initialSetupStep({ user: true, membership: false, stepParam: null })).toBe(1);
  });

  it('treats the old workspace URL as the combined form when there is no org yet', () => {
    expect(initialSetupStep({ user: true, membership: false, stepParam: '2' })).toBe(1);
  });

  it('maps billing URLs — current step 2 plus legacy 3/4/5 — onto billing', () => {
    expect(initialSetupStep({ user: true, membership: true, stepParam: '2' })).toBe(2);
    expect(initialSetupStep({ user: true, membership: true, stepParam: '5' })).toBe(2);
    expect(initialSetupStep({ user: true, membership: true, stepParam: '4' })).toBe(2);
    expect(initialSetupStep({ user: true, membership: true, stepParam: '3' })).toBe(2);
  });

  it('treats a Stripe checkout return as billing even before membership is known', () => {
    expect(
      initialSetupStep({
        user: false,
        membership: false,
        stepParam: '2',
        checkout: 'success',
      }),
    ).toBe(2);
    expect(
      initialSetupStep({
        user: false,
        membership: false,
        stepParam: '2',
        checkout: 'cancelled',
      }),
    ).toBe(2);
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
