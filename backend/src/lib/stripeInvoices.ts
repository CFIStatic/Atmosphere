/**
 * Stripe invoices for Settings → Billing.
 *
 * Receipt emails come from Stripe (Dashboard “Email customers about…”), not
 * from a custom sender. This module lists the same invoices in-product and
 * maps webhook events so `invoice.finalized` / `invoice.paid` stay in sync.
 */

import type Stripe from 'stripe';
import { isStripeConfigured, liveStripeCustomerId, stripeClient } from './stripe.js';

export const LISTABLE_INVOICE_STATUSES = ['open', 'paid', 'uncollectible', 'void'] as const;

export type BillingInvoiceStatus = (typeof LISTABLE_INVOICE_STATUSES)[number];

export interface BillingInvoice {
  id: string;
  number: string | null;
  status: BillingInvoiceStatus;
  amountCents: number;
  currency: string;
  description: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
  createdAt: string;
}

export interface StripeInvoiceLike {
  id?: string | null;
  number?: string | null;
  status?: string | null;
  amount_paid?: number | null;
  amount_due?: number | null;
  total?: number | null;
  currency?: string | null;
  description?: string | null;
  hosted_invoice_url?: string | null;
  invoice_pdf?: string | null;
  created?: number | null;
  lines?: { data?: Array<{ description?: string | null }> } | null;
}

export interface OrgBillingInvoices {
  invoices: BillingInvoice[];
  complimentary: boolean;
}

/** Subscription Checkout already creates invoices; one-time Checkout must opt in. */
export function checkoutInvoiceCreationFields(
  mode: 'subscription' | 'payment',
): Pick<Stripe.Checkout.SessionCreateParams, 'invoice_creation'> {
  if (mode === 'payment') {
    return { invoice_creation: { enabled: true } };
  }
  return {};
}

/** Explicit so same-day / overage invoices collect like subscription renewals. */
export function stripeAutoCollectInvoiceFields(): Pick<
  Stripe.InvoiceCreateParams,
  'collection_method'
> {
  return { collection_method: 'charge_automatically' };
}

export function isListableInvoiceStatus(status: string | null | undefined): status is BillingInvoiceStatus {
  return LISTABLE_INVOICE_STATUSES.includes((status ?? '') as BillingInvoiceStatus);
}

export function serializeStripeInvoice(invoice: StripeInvoiceLike): BillingInvoice | null {
  const id = invoice.id?.trim();
  if (!id || !isListableInvoiceStatus(invoice.status)) return null;

  const amountCents =
    invoice.status === 'paid'
      ? (invoice.amount_paid ?? invoice.total ?? 0)
      : (invoice.total ?? invoice.amount_due ?? 0);

  const created =
    typeof invoice.created === 'number' && Number.isFinite(invoice.created)
      ? new Date(invoice.created * 1000).toISOString()
      : new Date(0).toISOString();

  return {
    id,
    number: invoice.number ?? null,
    status: invoice.status,
    amountCents: Math.trunc(amountCents),
    currency: (invoice.currency ?? 'usd').toLowerCase(),
    description: invoice.description ?? invoice.lines?.data?.[0]?.description ?? null,
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    invoicePdfUrl: invoice.invoice_pdf ?? null,
    createdAt: created,
  };
}

export function invoiceWebhookRecord(
  eventType: string,
  invoice: { status?: string | null },
): { status: 'succeeded' | 'failed' | 'pending'; paid: boolean } {
  if (eventType === 'invoice.payment_failed' || invoice.status === 'uncollectible') {
    return { status: 'failed', paid: false };
  }
  if (eventType === 'invoice.paid' || invoice.status === 'paid') {
    return { status: 'succeeded', paid: true };
  }
  return { status: 'pending', paid: false };
}

export async function listStripeCustomerInvoices(
  customerId: string,
  limit: number,
): Promise<StripeInvoiceLike[]> {
  const listed = await stripeClient().invoices.list({
    customer: customerId,
    limit,
  });
  return listed.data;
}

/**
 * Invoices for an org’s Stripe customer. Complimentary / unconfigured orgs
 * return an empty list — never an error — so Settings can show a calm empty state.
 */
export async function loadOrgBillingInvoices(input: {
  customerId: string | null | undefined;
  billingExempt: boolean;
  stripeConfigured?: boolean;
  limit?: number;
  listInvoices?: (customerId: string, limit: number) => Promise<StripeInvoiceLike[]>;
}): Promise<OrgBillingInvoices> {
  const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 100);
  const customerId = liveStripeCustomerId(input.customerId);
  const stripeConfigured = input.stripeConfigured ?? isStripeConfigured();

  if (!customerId || !stripeConfigured) {
    return { invoices: [], complimentary: input.billingExempt };
  }

  try {
    const list = input.listInvoices ?? listStripeCustomerInvoices;
    const raw = await list(customerId, limit);
    return {
      invoices: raw
        .map(serializeStripeInvoice)
        .filter((row): row is BillingInvoice => row !== null),
      complimentary: input.billingExempt,
    };
  } catch (err) {
    console.warn(
      '[billing] stripe invoices unavailable:',
      err instanceof Error ? err.message : err,
    );
    return { invoices: [], complimentary: input.billingExempt };
  }
}

export function customerEmailBackfill(
  existingEmail: string | null | undefined,
  nextEmail: string | null | undefined,
): string | null {
  const next = nextEmail?.trim();
  if (!next) return null;
  if (existingEmail?.trim()) return null;
  return next;
}
