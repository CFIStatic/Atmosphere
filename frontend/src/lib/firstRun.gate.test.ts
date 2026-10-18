import { describe, expect, it } from 'vitest';
import { billingStepHref, unpaidWorkspaceTarget } from './firstRun';

describe('first run gate (account, then plan and invites)', () => {
  it('an unpaid workspace goes straight to plan and card on the Stripe-compatible step=2 URL', () => {
    expect(unpaidWorkspaceTarget('/verifier-library')).toBe('/signup?step=2&next=%2Fverifier-library');
    expect(unpaidWorkspaceTarget('/intake')).toBe('/signup?step=2&next=%2Fintake');
    expect(billingStepHref(null)).toBe('/signup?step=2');
  });

  it('keeps a specific deep link for after checkout', () => {
    expect(unpaidWorkspaceTarget('/settings?section=team')).toBe('/signup?step=2&next=%2Fsettings%3Fsection%3Dteam');
  });
});
