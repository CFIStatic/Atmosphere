/**
 * Complimentary (billing-exempt) workspaces never touch Stripe.
 *
 * A workspace is exempt when its subscription id is a `comp_…` token, its
 * status is `comped`, or its creator is on BILLING_EXEMPT_EMAILS (see
 * billingExempt.ts). For those workspaces:
 *   - a plan change is applied straight to org_billing, free;
 *   - Field Capture seats are granted free (stripeExtraSeats.ts);
 *   - anything that only exists to take money (credit packs, auto-recharge,
 *     legacy seat checkout, the Stripe portal) is refused with a plain message
 *     instead of opening Checkout. Paying there would also let the Stripe
 *     webhook overwrite the `comp_…` id and turn the comp into a paid plan.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { isBillingExemptOrg, loadOrgCreatorEmail } from './billingExempt.js';
import { badRequest } from './errors.js';
import { unscopedAdminOrNull } from './scopedAdmin.js';
import { atmospherePlan, type AtmosphereSelfServePlan } from './stripeCatalog.js';

export const COMPLIMENTARY_BILLING_CODE = 'billing_complimentary';

export type ComplimentaryPurchase = 'credits' | 'auto_recharge' | 'subscription';

const MESSAGES: Record<ComplimentaryPurchase, string> = {
  credits: 'This workspace is complimentary. AI credits are unlimited, so there is nothing to buy.',
  auto_recharge: 'This workspace is complimentary. AI credits are unlimited, so auto-recharge is not needed.',
  subscription: 'This workspace is complimentary. There is no plan to pay for.',
};

/** Throws a 400 before any Stripe call when a comped workspace tries to pay. */
export function assertNotComplimentaryPurchase(billingExempt: boolean, kind: ComplimentaryPurchase): void {
  if (billingExempt) throw badRequest(MESSAGES[kind], COMPLIMENTARY_BILLING_CODE);
}

/**
 * Switch a comped workspace's plan in the database. No Stripe call, no charge.
 * The `comp_…` subscription id is left alone, so the workspace stays exempt.
 */
export async function applyComplimentaryPlanChange(
  supabase: SupabaseClient,
  orgId: string,
  planCode: string,
  opts: { writer?: SupabaseClient | null } = {},
): Promise<AtmosphereSelfServePlan> {
  const plan = atmospherePlan(planCode);
  // org_billing has no authenticated UPDATE policy — a user JWT is a silent no-op.
  const writer = opts.writer ?? unscopedAdminOrNull() ?? supabase;
  const { data, error } = await writer
    .from('org_billing')
    .update({ atmosphere_plan_code: plan.code, included_fc_seats: plan.includedFcSeats })
    .eq('org_id', orgId)
    .select('org_id');
  if (error) throw new Error(`complimentary plan change failed: ${error.message}`);
  if (!data?.length) throw new Error('complimentary plan change failed: org_billing row was not updated');
  return plan;
}

/** Light exempt check for purchase routes (no metering summary). */
export async function loadOrgBillingExempt(
  supabase: SupabaseClient,
  orgId: string,
  actingUserEmail: string | null | undefined,
): Promise<boolean> {
  const [{ data: billing }, creatorEmail] = await Promise.all([
    supabase.from('org_billing').select('stripe_subscription_id, status').eq('org_id', orgId).maybeSingle(),
    loadOrgCreatorEmail(supabase, orgId),
  ]);
  const row = billing as { stripe_subscription_id?: string | null; status?: string | null } | null;
  return isBillingExemptOrg({
    status: row?.status,
    subscriptionId: row?.stripe_subscription_id,
    creatorEmail,
    actingUserEmail,
  });
}
