/**
 * Fields the Stripe webhook writes so staff analytics can report real money
 * (analytics audit 2026-10-07):
 *   - org_billing.stripe_mrr_cents / stripe_interval / stripe_livemode: the
 *     customer's net monthly recurring amount (see subscriptionMrr.ts)
 *   - payments.tax_cents / payments.livemode: so collected revenue excludes
 *     tax and test-mode money
 *   - payments.kind = 'usage' for same-day usage and overage invoices
 *
 * Every write tolerates a database where 20261007230000 is not applied yet:
 * a missing column or the old kind check falls back to the previous
 * behaviour instead of failing the webhook (which would make Stripe retry).
 */
import type Stripe from 'stripe';
import {
  customerMonthlyCents,
  mrrSubscriptionFromStripe,
  type MrrSubscription,
} from './subscriptionMrr.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

export const USAGE_INVOICE_KINDS = new Set(['same_day_usage', 'metering_overage']);

/** 'usage' for same-day usage / overage invoices, otherwise 'subscription'. */
export function invoicePaymentKind(invoice: { metadata?: Record<string, string> | null }): 'usage' | 'subscription' {
  const kind = invoice.metadata?.kind ?? '';
  return USAGE_INVOICE_KINDS.has(kind) ? 'usage' : 'subscription';
}

/** Tax on an invoice in cents, across Stripe API versions. */
export function invoiceTaxCents(invoice: Record<string, any>): number {
  if (Array.isArray(invoice.total_taxes)) {
    return invoice.total_taxes.reduce((sum: number, t: any) => sum + (Number(t?.amount) || 0), 0);
  }
  if (typeof invoice.tax === 'number') return invoice.tax;
  if (Array.isArray(invoice.total_tax_amounts)) {
    return invoice.total_tax_amounts.reduce((sum: number, t: any) => sum + (Number(t?.amount) || 0), 0);
  }
  return 0;
}

/** Tax on a paid invoice, scaled to what was actually paid (partial payments). */
export function paidInvoiceTaxCents(invoice: Record<string, any>, paidCents: number): number {
  const tax = invoiceTaxCents(invoice);
  const total = Number(invoice.total ?? 0);
  if (tax <= 0) return 0;
  if (total > 0 && paidCents >= 0 && paidCents < total) return Math.round((tax * paidCents) / total);
  return tax;
}

export function isMissingAnalyticsColumn(message: string | undefined | null): boolean {
  return /stripe_mrr_cents|stripe_interval|stripe_livemode|stripe_amount_synced_at|tax_cents|livemode|column .* does not exist|schema cache/i.test(
    message ?? '',
  );
}

export function isOldPaymentKindCheck(message: string | undefined | null): boolean {
  return /payments_kind_check|violates check constraint/i.test(message ?? '');
}

/** Write tax and mode onto an existing payments row. Best effort. */
export async function annotatePayment(
  admin: any,
  match: { column: 'stripe_invoice_id' | 'stripe_payment_intent_id' | 'stripe_charge_id'; value: string | null },
  fields: { taxCents?: number | null; livemode?: boolean | null },
): Promise<void> {
  if (!match.value) return;
  const patch: Record<string, unknown> = {};
  if (fields.taxCents != null) patch.tax_cents = Math.max(0, Math.round(fields.taxCents));
  if (typeof fields.livemode === 'boolean') patch.livemode = fields.livemode;
  if (Object.keys(patch).length === 0) return;
  const { error } = await admin.from('payments').update(patch).eq(match.column, match.value);
  if (error && !isMissingAnalyticsColumn(error.message)) {
    throw new Error(`payment annotate failed: ${error.message}`);
  }
}

/** Persist the customer's net monthly recurring amount on org_billing. */
export async function persistSubscriptionAmounts(
  admin: any,
  orgId: string,
  amounts: { mrrCents: number; interval: 'month' | 'year' | null; livemode: boolean | null },
  now: Date = new Date(),
): Promise<void> {
  const patch: Record<string, unknown> = {
    stripe_mrr_cents: Math.max(0, Math.round(amounts.mrrCents)),
    stripe_interval: amounts.interval,
    stripe_amount_synced_at: now.toISOString(),
  };
  if (typeof amounts.livemode === 'boolean') patch.stripe_livemode = amounts.livemode;
  const { error } = await admin.from('org_billing').update(patch).eq('org_id', orgId);
  if (error && !isMissingAnalyticsColumn(error.message)) {
    throw new Error(`subscription amount sync failed: ${error.message}`);
  }
}

/**
 * Every subscription of the customer, so a second subscription (extra seats)
 * is counted. Falls back to the subscription in the event when the list call
 * fails.
 */
export async function customerSubscriptionsForMrr(
  stripe: Pick<Stripe, 'subscriptions'>,
  customerId: string | null | undefined,
  eventSub: Record<string, any> | null,
): Promise<MrrSubscription[]> {
  const fromEvent = eventSub ? [mrrSubscriptionFromStripe(eventSub)] : [];
  if (!customerId) return fromEvent;
  try {
    const list = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 100,
      expand: ['data.discounts', 'data.default_tax_rates'],
    } as any);
    const subs = ((list as any)?.data ?? []) as Array<Record<string, any>>;
    const mapped = subs.map((s) => mrrSubscriptionFromStripe(s));
    // The event can be newer than the list (eventual consistency): prefer it.
    if (eventSub?.id) {
      const idx = mapped.findIndex((s) => s.id === eventSub.id);
      if (idx >= 0) mapped[idx] = fromEvent[0]!;
      else mapped.push(fromEvent[0]!);
    }
    return mapped;
  } catch (err) {
    console.warn('[stripe] could not list customer subscriptions for MRR; using the event only', err);
    return fromEvent;
  }
}

/** Compute and store the customer's MRR. Never throws for a pre-migration DB. */
export async function syncCustomerMrr(
  admin: any,
  stripe: Pick<Stripe, 'subscriptions'>,
  orgId: string,
  customerId: string | null | undefined,
  eventSub: Record<string, any> | null,
): Promise<void> {
  const subs = await customerSubscriptionsForMrr(stripe, customerId, eventSub);
  const mrr = customerMonthlyCents(subs);
  await persistSubscriptionAmounts(admin, orgId, mrr);
}
