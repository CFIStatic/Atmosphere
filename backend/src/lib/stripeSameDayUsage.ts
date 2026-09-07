/**
 * Same-day token/AI usage invoices.
 *
 * Token metering stores `price_nanos` at 10× COGS. When billable usage is
 * recorded for an org with a Stripe customer, we invoice leftover cents for
 * that UTC day (one invoice per increment after prior same-day invoices).
 * Period-close remains the safety net for leftovers.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import { config } from '../config.js';
import { loadOrgCreatorEmail, shouldSkipUsageBilling } from './billingExempt.js';
import { nanosToCents } from './money.js';
import { adminClient, isStripeConfigured, stripeClient, stripeIdempotencyKey } from './stripe.js';

export const SAME_DAY_USAGE_KIND = 'same_day_usage';

export function usageDayUtc(at: Date | string = new Date()): string {
  const date = typeof at === 'string' ? new Date(at) : at;
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

/** Cents still owed today after prior same-day invoices. Sub-cent leftovers stay 0. */
export function sameDayUsageChargeCents(billableNanos: number, alreadyInvoicedCents: number): number {
  const totalCents = nanosToCents(Math.max(0, billableNanos));
  const invoiced = Math.max(0, Math.floor(alreadyInvoicedCents));
  return Math.max(0, totalCents - invoiced);
}

export function isSameDayUsageInvoice(
  invoice: { metadata?: Stripe.Metadata | null },
  orgId: string,
  day: string,
): boolean {
  return (
    invoice.metadata?.org_id === orgId &&
    invoice.metadata?.kind === SAME_DAY_USAGE_KIND &&
    invoice.metadata?.usage_day === day
  );
}

export function sameDayUsageAlreadyIssued(status: string | null | undefined): boolean {
  return status === 'open' || status === 'paid' || status === 'uncollectible' || status === 'void';
}

export function alreadyInvoicedSameDayCents(
  invoices: Array<{ metadata?: Stripe.Metadata | null; status?: string | null; amount_paid?: number | null; amount_due?: number | null }>,
  orgId: string,
  day: string,
): number {
  let cents = 0;
  for (const invoice of invoices) {
    if (!isSameDayUsageInvoice(invoice, orgId, day)) continue;
    if (!sameDayUsageAlreadyIssued(invoice.status)) continue;
    const amount =
      invoice.status === 'paid'
        ? (invoice.amount_paid ?? invoice.amount_due ?? 0)
        : (invoice.amount_due ?? invoice.amount_paid ?? 0);
    cents += Math.max(0, amount);
  }
  return cents;
}

export interface SameDayUsageStripe {
  invoices: {
    list: (params: Stripe.InvoiceListParams) => Promise<Stripe.ApiList<Stripe.Invoice>>;
    create: (
      params: Stripe.InvoiceCreateParams,
      options?: Stripe.RequestOptions,
    ) => Promise<Stripe.Invoice>;
    finalizeInvoice: (id: string) => Promise<Stripe.Invoice>;
    pay: (id: string) => Promise<Stripe.Invoice>;
    del?: (id: string) => Promise<unknown>;
  };
  invoiceItems: {
    create: (
      params: Stripe.InvoiceItemCreateParams,
      options?: Stripe.RequestOptions,
    ) => Promise<Stripe.InvoiceItem>;
  };
}

export interface SameDayUsageInvoiceInput {
  customerId: string;
  orgId: string;
  day: string;
  billableNanos: number;
  existingInvoices?: Stripe.Invoice[];
  refreshInvoices?: () => Promise<Stripe.Invoice[]>;
}

const sameDayLocks = new Map<string, Promise<unknown>>();

export function sameDayUsageLockKey(orgId: string, day: string): string {
  return `${orgId}:${day}`;
}

/** One in-flight same-day invoice per org+day so overlapping token events do not double-charge. */
export async function enqueueSameDayUsage<T>(
  orgId: string,
  day: string,
  work: () => Promise<T>,
): Promise<T> {
  const key = sameDayUsageLockKey(orgId, day);
  const previous = sameDayLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => gate);
  sameDayLocks.set(key, queued);
  await previous.catch(() => undefined);
  try {
    return await work();
  } finally {
    release();
    if (sameDayLocks.get(key) === queued) sameDayLocks.delete(key);
  }
}

export async function invoiceSameDayUsageCharge(
  stripe: SameDayUsageStripe,
  input: SameDayUsageInvoiceInput,
): Promise<{ invoiceId: string | null; skipped: string | null; amountCents: number }> {
  const already = alreadyInvoicedSameDayCents(input.existingInvoices ?? [], input.orgId, input.day);
  const amountCents = sameDayUsageChargeCents(input.billableNanos, already);
  if (amountCents < 1) {
    return { invoiceId: null, skipped: already > 0 ? 'already_invoiced' : 'below_cent', amountCents: 0 };
  }

  const key = stripeIdempotencyKey('same-day-usage', input.orgId, input.day, already);
  const invoice = await stripe.invoices.create(
    {
      customer: input.customerId,
      auto_advance: false,
      pending_invoice_items_behavior: 'exclude',
      description: `Atmosphere AI usage ${input.day}`,
      metadata: {
        org_id: input.orgId,
        kind: SAME_DAY_USAGE_KIND,
        usage_day: input.day,
      },
    },
    { idempotencyKey: key },
  );

  if (sameDayUsageAlreadyIssued(invoice.status) && (invoice.lines?.data?.length ?? 0) > 0) {
    return { invoiceId: invoice.id, skipped: 'already_invoiced', amountCents };
  }

  if (input.refreshInvoices) {
    const latest = await input.refreshInvoices();
    const others = alreadyInvoicedSameDayCents(
      latest.filter((row) => row.id !== invoice.id),
      input.orgId,
      input.day,
    );
    if (others + amountCents > nanosToCents(input.billableNanos) && invoice.status === 'draft') {
      if (stripe.invoices.del) await stripe.invoices.del(invoice.id);
      return { invoiceId: null, skipped: 'coalesced', amountCents: 0 };
    }
  }

  if ((invoice.lines?.data?.length ?? 0) === 0) {
    try {
      await stripe.invoiceItems.create(
        {
          customer: input.customerId,
          invoice: invoice.id,
          currency: 'usd',
          amount: amountCents,
          description: `AI / token usage ${input.day}`,
        },
        { idempotencyKey: stripeIdempotencyKey(key, 'line') },
      );
    } catch (err) {
      const e = err as { type?: string; rawType?: string; code?: string; message?: string };
      const conflict =
        e?.type === 'StripeIdempotencyError' ||
        e?.type === 'idempotency_error' ||
        e?.rawType === 'idempotency_error' ||
        e?.code === 'idempotency_key_in_use' ||
        /idempotenc/i.test(e?.message ?? '');
      if (!conflict) throw err;
      return { invoiceId: invoice.id, skipped: 'already_invoiced', amountCents };
    }
  }

  const finalized =
    invoice.status === 'draft' ? await stripe.invoices.finalizeInvoice(invoice.id) : invoice;
  if (finalized.status === 'open') {
    try {
      await stripe.invoices.pay(finalized.id);
    } catch (err) {
      console.error(`[stripe] same-day usage invoice ${finalized.id} could not be collected:`, err);
    }
  }
  return { invoiceId: finalized.id, skipped: null, amountCents };
}

async function listCustomerInvoices(
  stripe: SameDayUsageStripe,
  customerId: string,
): Promise<Stripe.Invoice[]> {
  const invoices: Stripe.Invoice[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < 5; page += 1) {
    const batch = await stripe.invoices.list({
      customer: customerId,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    invoices.push(...batch.data);
    if (!batch.has_more || batch.data.length === 0) break;
    startingAfter = batch.data[batch.data.length - 1]?.id;
  }
  return invoices;
}

function usageAdminClient(fallback: SupabaseClient): SupabaseClient {
  try {
    return adminClient();
  } catch {
    return fallback;
  }
}

async function billableNanosForDay(
  supabase: SupabaseClient,
  orgId: string,
  day: string,
): Promise<number> {
  const start = `${day}T00:00:00.000Z`;
  const end = new Date(`${day}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const client = usageAdminClient(supabase);
  const { data, error } = await client
    .from('token_usage_events')
    .select('price_nanos')
    .eq('org_id', orgId)
    .gte('created_at', start)
    .lt('created_at', end.toISOString());
  if (error) throw new Error(`same-day usage lookup failed: ${error.message}`);
  return (data ?? []).reduce((sum, row) => sum + Number((row as { price_nanos?: number }).price_nanos ?? 0), 0);
}

/**
 * Invoice leftover billable token usage for one UTC day.
 * Idempotent: already-paid same-day invoices are subtracted first.
 */
export async function invoiceSameDayUsage(
  supabase: SupabaseClient,
  orgId: string,
  day: string = usageDayUtc(),
): Promise<{ invoiceId: string | null; skipped: string | null; amountCents: number }> {
  return enqueueSameDayUsage(orgId, day, () => invoiceSameDayUsageUnlocked(supabase, orgId, day));
}

async function invoiceSameDayUsageUnlocked(
  supabase: SupabaseClient,
  orgId: string,
  day: string,
): Promise<{ invoiceId: string | null; skipped: string | null; amountCents: number }> {
  if (config.billing.paymentProvider !== 'stripe' || !isStripeConfigured()) {
    return { invoiceId: null, skipped: 'stripe_unconfigured', amountCents: 0 };
  }

  const { data: billing, error } = await usageAdminClient(supabase)
    .from('org_billing')
    .select('stripe_customer_id, status')
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw new Error(`same-day usage customer lookup failed: ${error.message}`);

  const customerId = billing?.stripe_customer_id as string | undefined;
  if (!customerId) return { invoiceId: null, skipped: 'no_customer', amountCents: 0 };

  const status = (billing?.status as string | undefined) ?? '';
  const creatorEmail = await loadOrgCreatorEmail(usageAdminClient(supabase), orgId);
  if (shouldSkipUsageBilling({ status, creatorEmail })) {
    return { invoiceId: null, skipped: 'billing_exempt', amountCents: 0 };
  }
  if (status && !['active', 'trialing', 'past_due'].includes(status)) {
    return { invoiceId: null, skipped: 'inactive_customer', amountCents: 0 };
  }

  const billableNanos = await billableNanosForDay(supabase, orgId, day);
  if (billableNanos <= 0) return { invoiceId: null, skipped: 'no_usage', amountCents: 0 };

  const stripe = stripeClient();
  const api: SameDayUsageStripe = {
    invoices: {
      list: (params) => stripe.invoices.list(params),
      create: (params, options) => stripe.invoices.create(params, options),
      finalizeInvoice: (id) => stripe.invoices.finalizeInvoice(id),
      pay: (id) => stripe.invoices.pay(id),
      del: (id) => stripe.invoices.del(id),
    },
    invoiceItems: {
      create: (params, options) => stripe.invoiceItems.create(params, options),
    },
  };
  const existingInvoices = await listCustomerInvoices(api, customerId);
  return invoiceSameDayUsageCharge(api, {
    customerId,
    orgId,
    day,
    billableNanos,
    existingInvoices,
    refreshInvoices: () => listCustomerInvoices(api, customerId),
  });
}

export function invoiceSameDayUsageAsync(supabase: SupabaseClient, orgId: string, day?: string): void {
  void invoiceSameDayUsage(supabase, orgId, day ?? usageDayUtc()).catch((err) => {
    console.error('[stripe] same-day usage invoice failed', { orgId, day, err });
  });
}

/** Period-close safety net: invoice leftover usage for each day in [from, to). */
export async function invoiceLeftoverUsageDays(
  supabase: SupabaseClient,
  orgId: string,
  fromIso: string,
  toIso: string,
): Promise<Array<{ day: string; invoiceId: string | null; skipped: string | null }>> {
  const start = new Date(fromIso);
  const end = new Date(toIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];

  const results: Array<{ day: string; invoiceId: string | null; skipped: string | null }> = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (cursor < last) {
    const day = cursor.toISOString().slice(0, 10);
    const result = await invoiceSameDayUsage(supabase, orgId, day);
    results.push({ day, invoiceId: result.invoiceId, skipped: result.skipped });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return results;
}
