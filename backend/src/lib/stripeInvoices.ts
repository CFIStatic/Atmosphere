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

export interface BillingInvoiceLine {
  description: string | null;
  quantity: number | null;
  unitAmountCents: number | null;
  amountCents: number;
}

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
  lines: BillingInvoiceLine[];
}

export interface StripeInvoiceLineLike {
  description?: string | null;
  quantity?: number | null;
  quantity_decimal?: string | number | null;
  amount?: number | null;
  subtotal?: number | null;
  pricing?: { unit_amount_decimal?: string | number | null } | null;
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
  lines?: { data?: StripeInvoiceLineLike[] } | null;
}

/**
 * One analysis unit is $0.01 so leftover token/AI cents factor exactly as
 * quantity × unit price on Stripe PDFs and in Settings → Billing.
 */
export const ANALYSIS_UNIT_CENTS = 1;

export function analysisUnitsFromCents(amountCents: number): {
  quantity: number;
  unitAmountCents: number;
} {
  const cents = Math.max(0, Math.trunc(amountCents));
  return { quantity: cents, unitAmountCents: ANALYSIS_UNIT_CENTS };
}

/** Prefer an explicit qty × unit when it equals the charge; otherwise 1¢ units. */
export function quantityUnitForAmount(
  amountCents: number,
  preferredQuantity?: number | null,
  preferredUnitCents?: number | null,
): { quantity: number; unitAmountCents: number } {
  const amount = Math.max(0, Math.trunc(amountCents));
  const qty = preferredQuantity != null ? Math.trunc(preferredQuantity) : 0;
  const unit = preferredUnitCents != null ? Math.trunc(preferredUnitCents) : 0;
  if (qty > 0 && unit > 0 && qty * unit === amount) {
    return { quantity: qty, unitAmountCents: unit };
  }
  if (qty > 0 && amount % qty === 0) {
    return { quantity: qty, unitAmountCents: amount / qty };
  }
  return analysisUnitsFromCents(amount);
}

/**
 * Create-time qty × unit. 2026-06-24.dahlia still takes top-level
 * `unit_amount_decimal` (string) on InvoiceItem create. Response lines
 * put that same figure on `pricing.unit_amount_decimal`. `pricing` on
 * create is a Price id, not an ad-hoc unit amount.
 */
export function stripeQuantityInvoiceItemFields(input: {
  quantity: number;
  unitAmountCents: number;
  description: string;
}): Pick<Stripe.InvoiceItemCreateParams, 'quantity' | 'unit_amount_decimal' | 'description'> {
  return {
    quantity: input.quantity,
    unit_amount_decimal: String(
      Math.trunc(input.unitAmountCents),
    ) as unknown as Stripe.InvoiceItemCreateParams['unit_amount_decimal'],
    description: input.description,
  };
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

function stripeDecimalNumber(value: string | number | { toString(): string } | null | undefined): number | null {
  if (value == null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function serializeStripeInvoiceLine(line: StripeInvoiceLineLike): BillingInvoiceLine {
  const quantityRaw =
    line.quantity ??
    (line.quantity_decimal != null && line.quantity_decimal !== ''
      ? stripeDecimalNumber(line.quantity_decimal)
      : null);
  const quantity =
    quantityRaw != null && Number.isFinite(quantityRaw) && quantityRaw > 0 ? quantityRaw : null;
  const amountCents = Math.trunc(line.amount ?? line.subtotal ?? 0);
  const priced = stripeDecimalNumber(line.pricing?.unit_amount_decimal);
  const unitAmountCents =
    priced != null
      ? Math.round(priced)
      : quantity
        ? Math.round(amountCents / quantity)
        : null;
  return {
    description: line.description ?? null,
    quantity,
    unitAmountCents,
    amountCents,
  };
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
    lines: (invoice.lines?.data ?? []).map(serializeStripeInvoiceLine),
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

/**
 * A retried `invoice.finalized` snapshot is typically still `open` → pending.
 * Stripe does not order events, so that must not overwrite a paid or failed row.
 */
export function invoiceWebhookShouldApply(
  next: { status: 'succeeded' | 'failed' | 'pending' },
  existingStatus?: string | null,
): boolean {
  if (next.status !== 'pending') return true;
  return existingStatus !== 'succeeded' && existingStatus !== 'failed';
}

/** List params only — `pricing` is an embedded hash, not expandable. */
export function stripeInvoiceListParams(customerId: string, limit: number): Stripe.InvoiceListParams {
  return { customer: customerId, limit };
}

export async function listStripeCustomerInvoices(
  customerId: string,
  limit: number,
): Promise<StripeInvoiceLike[]> {
  const listed = await stripeClient().invoices.list(stripeInvoiceListParams(customerId, limit));
  return listed.data as StripeInvoiceLike[];
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
