/**
 * Wires auto-recharge to the real database and Stripe. Loaded lazily by the
 * AI gate, only when an org is out of credits.
 */

import { config } from '../config.js';
import { unscopedAdminOrNull } from '../lib/scopedAdmin.js';
import { stripeClient } from '../lib/stripe.js';
import { runAutoRecharge, stripeAutoRechargeAdapter, supabaseAutoRechargeStore } from './autoRecharge.js';

/** True only when a pack was bought and credited just now. Never throws. */
export async function autoRechargeOnExhaustion(orgId: string, trigger: string): Promise<boolean> {
  if (config.billing.paymentProvider !== 'stripe' || !config.stripe.secretKey) return false;
  const admin = unscopedAdminOrNull();
  if (!admin) return false;
  try {
    const outcome = await runAutoRecharge(
      { store: supabaseAutoRechargeStore(admin), stripe: stripeAutoRechargeAdapter(stripeClient()) },
      orgId,
      trigger,
    );
    if (outcome.status === 'failed') {
      console.warn(`[ai-auto-recharge] org ${orgId}: ${outcome.code}; auto-recharge turned off`);
    }
    return outcome.status === 'succeeded';
  } catch (err) {
    console.warn(`[ai-auto-recharge] org ${orgId}: could not run`, err);
    return false;
  }
}
