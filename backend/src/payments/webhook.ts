import type Stripe from 'stripe';
import { paymentStatusFromSession } from './model.js';
import { holdInvoiceLines } from './release.js';
import { allocateRefund } from './disputes.js';

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
    // Funds now sit on the platform balance: hold every line until release.
    await holdInvoiceLines(admin, row.org_id, row.invoice_id);
  }
}

/**
 * charge.refunded on a job payment (full or partial, from our route or the
 * Stripe dashboard): allocate the new refunded amount across lines, reversing
 * released transfers as needed. Idempotent via job_payments.refunded_cents.
 */
export async function applyJobPaymentRefund(admin: any, charge: Stripe.Charge): Promise<boolean> {
  const pi = stripeId(charge.payment_intent);
  if (!pi) return false;
  const { data: row } = await admin
    .from('job_payments')
    .select('id, org_id')
    .eq('stripe_payment_intent_id', pi)
    .maybeSingle();
  if (!row) return false;
  await allocateRefund(admin, row.id, Number(charge.amount_refunded ?? 0));
  return true;
}

/** payout.* on a connected account (Connect webhook): last payout status. */
export async function applyConnectedPayout(admin: any, accountId: string, payout: Stripe.Payout, eventType: string): Promise<void> {
  const { error } = await admin
    .from('org_payment_accounts')
    .update({ last_payout_status: payout.status ?? eventType.replace('payout.', ''), last_payout_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('stripe_account_id', accountId);
  if (error) throw new Error(`connected account ${accountId} payout write failed: ${error.message}`);
}

/** account.application.deauthorized: the contractor disconnected Atmosphere. */
export async function applyConnectedDeauthorized(admin: any, accountId: string): Promise<void> {
  const { error } = await admin
    .from('org_payment_accounts')
    .update({ charges_enabled: false, payouts_enabled: false, deauthorized_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('stripe_account_id', accountId);
  if (error) throw new Error(`connected account ${accountId} deauthorize write failed: ${error.message}`);
}

/** transfer.reversed (platform): keep the line's reversed total in sync with Stripe. */
export async function applyTransferReversed(admin: any, transfer: Stripe.Transfer): Promise<boolean> {
  if (transfer.metadata?.kind !== 'job_line_release') return false;
  const lineId = transfer.metadata.line_id;
  const { data: line } = await admin.from('job_invoice_lines').select('id, org_id, reversed_cents, release_cents').eq('id', lineId).eq('stripe_transfer_id', transfer.id).maybeSingle();
  if (!line) return true;
  const reversed = Number(transfer.amount_reversed ?? 0);
  if (reversed <= Number(line.reversed_cents || 0)) return true;
  const { error } = await admin
    .from('job_invoice_lines')
    .update({ reversed_cents: reversed, ...(transfer.reversed ? { release_status: 'reversed' } : {}) })
    .eq('id', line.id)
    .eq('org_id', line.org_id);
  if (error) throw new Error(`line ${line.id} reversal sync failed: ${error.message}`);
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
