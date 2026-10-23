import type Stripe from 'stripe';
import { paymentStatusFromSession } from './model.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** True when this Stripe object belongs to a homeowner job payment. */
export function isJobPaymentMetadata(meta: Stripe.Metadata | null | undefined): boolean {
  return meta?.kind === 'job_payment' && typeof meta?.payment_id === 'string';
}

function stripeId(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return typeof (value as any).id === 'string' ? (value as any).id : null;
}

/**
 * Apply one Checkout event to the job_payments row (and the invoice when
 * paid). Idempotent: replaying an event writes the same values. A paid row
 * is never moved back to pending/expired by a late event.
 */
export async function applyJobPaymentSession(
  admin: any,
  session: Stripe.Checkout.Session,
  eventType: string,
): Promise<void> {
  const paymentId = String(session.metadata?.payment_id);
  const { data: row, error: loadError } = await admin
    .from('job_payments')
    .select('id, org_id, job_id, invoice_id, status, stripe_checkout_session_id')
    .eq('id', paymentId)
    .maybeSingle();
  if (loadError) throw new Error(`job payment ${paymentId} load failed: ${loadError.message}`);
  if (!row) throw new Error(`job payment ${paymentId} not found for ${session.id}`);
  if (row.stripe_checkout_session_id && row.stripe_checkout_session_id !== session.id) {
    throw new Error(`job payment ${paymentId} session mismatch`);
  }
  if (row.org_id !== session.metadata?.org_id || row.job_id !== session.metadata?.job_id) {
    throw new Error(`job payment ${paymentId} metadata mismatch`);
  }

  let status: string = paymentStatusFromSession(session);
  if (eventType === 'checkout.session.async_payment_succeeded') status = 'paid';
  if (eventType === 'checkout.session.async_payment_failed') status = 'failed';
  if (row.status === 'paid' || row.status === 'refunded') {
    if (status !== 'paid') return;
  }

  const now = new Date().toISOString();
  const method = (session.payment_method_types ?? []).length === 1 ? session.payment_method_types[0] : null;
  const patch: Record<string, unknown> = {
    status,
    updated_at: now,
    stripe_checkout_session_id: session.id,
    stripe_payment_intent_id: stripeId(session.payment_intent),
    payer_email: session.customer_details?.email ?? null,
  };
  if (method) patch.method = method;
  if (status === 'paid') patch.paid_at = row.status === 'paid' ? undefined : now;
  if (patch.paid_at === undefined) delete patch.paid_at;

  const { error } = await admin.from('job_payments').update(patch).eq('id', row.id).eq('org_id', row.org_id);
  if (error) throw new Error(`job payment ${row.id} update failed: ${error.message}`);

  if (status === 'paid' && row.invoice_id) {
    const { error: invError } = await admin
      .from('job_invoices')
      .update({ status: 'paid', paid_at: now, updated_at: now })
      .eq('id', row.invoice_id)
      .eq('org_id', row.org_id)
      .neq('status', 'paid');
    if (invError) throw new Error(`job invoice ${row.invoice_id} update failed: ${invError.message}`);
  }
}

/** A refund on a job payment's charge marks the payment refunded (full refunds only). */
export async function applyJobPaymentRefund(admin: any, charge: Stripe.Charge): Promise<boolean> {
  const pi = stripeId(charge.payment_intent);
  if (!pi) return false;
  const { data: row } = await admin
    .from('job_payments')
    .select('id, org_id')
    .eq('stripe_payment_intent_id', pi)
    .maybeSingle();
  if (!row) return false;
  if (charge.refunded) {
    const { error } = await admin
      .from('job_payments')
      .update({ status: 'refunded', updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('org_id', row.org_id);
    if (error) throw new Error(`job payment ${row.id} refund update failed: ${error.message}`);
  }
  return true;
}

/** account.updated on a connected account: mirror onboarding state. */
export async function applyConnectedAccount(admin: any, account: Stripe.Account): Promise<void> {
  const { error } = await admin
    .from('org_payment_accounts')
    .update(connectedAccountPatch(account))
    .eq('stripe_account_id', account.id);
  if (error) throw new Error(`connected account ${account.id} update failed: ${error.message}`);
}

export function connectedAccountPatch(account: Stripe.Account) {
  return {
    charges_enabled: Boolean(account.charges_enabled),
    payouts_enabled: Boolean(account.payouts_enabled),
    details_submitted: Boolean(account.details_submitted),
    requirements_due: [...(account.requirements?.currently_due ?? [])].slice(0, 50),
    updated_at: new Date().toISOString(),
  };
}
