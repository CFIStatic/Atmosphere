import { config } from '../config.js';
import { isBillingExemptOrg, loadOrgCreatorEmail } from './billingExempt.js';
import { paymentRequired } from './errors.js';
import { billingOnboardingGate } from './signupOnboarding.js';

type BillingLookup = {
  from: (table: string) => any;
  // Real Supabase clients are passed at the routes. `any` on `from` keeps
  // the builder chain (select/eq/maybeSingle) without fighting overloads.
};

export const PRODUCT_ACTION_LOCKED_MESSAGE =
  'Choose a plan to upload, record, share, or invite.';

export const PRODUCT_ACTION_LOCKED_CODE = 'billing_required';

/**
 * Unpaid org creators can open their first job. Upload, recording, sharing,
 * and inviting stay locked until the workspace has a subscription.
 */
export function productActionsLocked(input: {
  paymentProvider: string;
  exempt?: boolean;
  subscriptionId: string | null | undefined;
  subscriptionStatus: string | null | undefined;
}): boolean {
  const gate = billingOnboardingGate({
    paymentProvider: input.paymentProvider,
    isCreator: true,
    subscriptionId: input.subscriptionId,
    subscriptionStatus: input.subscriptionStatus,
    exempt: input.exempt,
  });
  return gate.required && !gate.complete;
}

/**
 * Throws 402 when this org has not finished plan and card.
 * Dev and manual billing (no Stripe secret) stay open so local tests can upload.
 */
export async function assertOrgProductActionsAllowed(
  supabase: BillingLookup,
  orgId: string,
  paymentProvider: string = config.billing.paymentProvider,
): Promise<void> {
  if (paymentProvider !== 'stripe') return;
  const [{ data: billing, error: billingError }, creatorEmail] = await Promise.all([
    supabase
      .from('org_billing')
      .select('stripe_subscription_id, status')
      .eq('org_id', orgId)
      .maybeSingle(),
    loadOrgCreatorEmail(supabase as never, orgId),
  ]);
  if (billingError) {
    throw new Error(`billing lookup failed: ${billingError.message}`);
  }
  const row = billing as { stripe_subscription_id?: string | null; status?: string | null } | null;
  const locked = productActionsLocked({
    paymentProvider,
    exempt: isBillingExemptOrg({
      status: row?.status,
      subscriptionId: row?.stripe_subscription_id,
      creatorEmail,
    }),
    subscriptionId: row?.stripe_subscription_id,
    subscriptionStatus: row?.status,
  });
  if (locked) {
    throw paymentRequired(PRODUCT_ACTION_LOCKED_MESSAGE, PRODUCT_ACTION_LOCKED_CODE);
  }
}
