/**
 * Signup billing contract.
 *
 * The website wizard is two steps: account + workspace, then Stripe.
 * There is no invite gate — teammates can be asked later from Settings.
 * These helpers keep the checkout return URL and the "may they enter the
 * product?" rule in one place so a UI change cannot silently send Stripe
 * back to a removed step, or keep a paid org blocked waiting for invites.
 */

export const SIGNUP_BILLING_STEP = '2';

export function signupCheckoutReturnUrl(input: {
  base: string;
  kind: 'success' | 'cancelled';
  returnPath?: string;
}): string {
  const params = new URLSearchParams({ step: SIGNUP_BILLING_STEP, checkout: input.kind });
  if (input.returnPath) params.set('next', input.returnPath);
  return `${input.base}?${params.toString()}`;
}

export function billingOnboardingGate(input: {
  paymentProvider: string;
  isCreator: boolean;
  subscriptionId: string | null | undefined;
  subscriptionStatus: string | null | undefined;
}): { required: boolean; complete: boolean; hasSubscription: boolean } {
  const hasSubscription =
    Boolean(input.subscriptionId) &&
    ['active', 'trialing'].includes(String(input.subscriptionStatus ?? ''));
  const required = input.paymentProvider === 'stripe' && input.isCreator;
  // Paid (or not the person who has to pay) is enough. Invites are optional.
  const complete = !required || hasSubscription;
  return { required, complete, hasSubscription };
}
