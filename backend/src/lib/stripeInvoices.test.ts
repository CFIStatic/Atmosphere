import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkoutInvoiceCreationFields,
  customerEmailBackfill,
  invoiceWebhookRecord,
  loadOrgBillingInvoices,
  serializeStripeInvoice,
  stripeAutoCollectInvoiceFields,
  type StripeInvoiceLike,
} from './stripeInvoices.js';

const paidInvoice: StripeInvoiceLike = {
  id: 'in_paid',
  number: 'INV-0008',
  status: 'paid',
  amount_paid: 84900,
  amount_due: 0,
  total: 84900,
  currency: 'usd',
  description: 'Work Verification — August',
  hosted_invoice_url: 'https://invoice.stripe.com/i/paid',
  invoice_pdf: 'https://pay.stripe.com/invoice/paid/pdf',
  created: 1_754_006_700,
};

const openInvoice: StripeInvoiceLike = {
  id: 'in_open',
  number: 'INV-0009',
  status: 'open',
  amount_paid: 0,
  amount_due: 3700,
  total: 3700,
  currency: 'usd',
  description: null,
  hosted_invoice_url: 'https://invoice.stripe.com/i/open',
  invoice_pdf: null,
  created: 1_754_093_100,
  lines: { data: [{ description: 'Atmosphere AI usage 2026-09-08' }] },
};

describe('serializeStripeInvoice', () => {
  it('maps a paid invoice to the Billing list row', () => {
    assert.deepEqual(serializeStripeInvoice(paidInvoice), {
      id: 'in_paid',
      number: 'INV-0008',
      status: 'paid',
      amountCents: 84900,
      currency: 'usd',
      description: 'Work Verification — August',
      hostedInvoiceUrl: 'https://invoice.stripe.com/i/paid',
      invoicePdfUrl: 'https://pay.stripe.com/invoice/paid/pdf',
      createdAt: '2025-08-01T00:05:00.000Z',
    });
  });

  it('uses the first line description and total for an open usage invoice', () => {
    const row = serializeStripeInvoice(openInvoice);
    assert.equal(row?.status, 'open');
    assert.equal(row?.amountCents, 3700);
    assert.equal(row?.description, 'Atmosphere AI usage 2026-09-08');
    assert.equal(row?.hostedInvoiceUrl, 'https://invoice.stripe.com/i/open');
  });

  it('drops drafts so they never appear as receipts', () => {
    assert.equal(serializeStripeInvoice({ ...paidInvoice, status: 'draft' }), null);
    assert.equal(serializeStripeInvoice({ ...paidInvoice, id: '' }), null);
  });
});

describe('loadOrgBillingInvoices', () => {
  it('lists paid and open invoices for a live Stripe customer', async () => {
    const result = await loadOrgBillingInvoices({
      customerId: 'cus_live1',
      billingExempt: false,
      stripeConfigured: true,
      listInvoices: async (customerId, limit) => {
        assert.equal(customerId, 'cus_live1');
        assert.equal(limit, 25);
        return [paidInvoice, openInvoice, { ...paidInvoice, id: 'in_draft', status: 'draft' }];
      },
      limit: 25,
    });

    assert.equal(result.complimentary, false);
    assert.deepEqual(
      result.invoices.map((row) => row.id),
      ['in_paid', 'in_open'],
    );
  });

  it('returns an empty complimentary list without calling Stripe', async () => {
    let called = false;
    const result = await loadOrgBillingInvoices({
      customerId: 'comp_jack_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      billingExempt: true,
      stripeConfigured: true,
      listInvoices: async () => {
        called = true;
        return [paidInvoice];
      },
    });

    assert.equal(called, false);
    assert.deepEqual(result, { invoices: [], complimentary: true });
  });

  it('returns an empty complimentary list when Stripe is not configured', async () => {
    const result = await loadOrgBillingInvoices({
      customerId: 'cus_live1',
      billingExempt: true,
      stripeConfigured: false,
      listInvoices: async () => {
        throw new Error('should not list');
      },
    });
    assert.deepEqual(result, { invoices: [], complimentary: true });
  });

  it('swallows Stripe errors so complimentary orgs never see a billing error', async () => {
    const result = await loadOrgBillingInvoices({
      customerId: 'cus_live1',
      billingExempt: true,
      stripeConfigured: true,
      listInvoices: async () => {
        throw new Error('stripe down');
      },
    });
    assert.deepEqual(result, { invoices: [], complimentary: true });
  });

  it('returns empty, not complimentary, when a paid org has no customer yet', async () => {
    const result = await loadOrgBillingInvoices({
      customerId: null,
      billingExempt: false,
      stripeConfigured: true,
    });
    assert.deepEqual(result, { invoices: [], complimentary: false });
  });
});

describe('invoice webhook status', () => {
  it('records finalized open invoices as pending so they appear before collection', () => {
    assert.deepEqual(invoiceWebhookRecord('invoice.finalized', { status: 'open' }), {
      status: 'pending',
      paid: false,
    });
  });

  it('treats invoice.paid and a paid finalized invoice as succeeded', () => {
    assert.deepEqual(invoiceWebhookRecord('invoice.paid', { status: 'paid' }), {
      status: 'succeeded',
      paid: true,
    });
    assert.deepEqual(invoiceWebhookRecord('invoice.finalized', { status: 'paid' }), {
      status: 'succeeded',
      paid: true,
    });
  });

  it('marks failed collection separately from an open finalized invoice', () => {
    assert.deepEqual(invoiceWebhookRecord('invoice.payment_failed', { status: 'open' }), {
      status: 'failed',
      paid: false,
    });
  });
});

describe('checkout and invoice create fields', () => {
  it('enables invoice creation only on one-time Checkout', () => {
    assert.deepEqual(checkoutInvoiceCreationFields('payment'), {
      invoice_creation: { enabled: true },
    });
    assert.deepEqual(checkoutInvoiceCreationFields('subscription'), {});
  });

  it('charges usage invoices automatically', () => {
    assert.deepEqual(stripeAutoCollectInvoiceFields(), {
      collection_method: 'charge_automatically',
    });
  });

  it('backfills a missing Stripe customer email and leaves an existing one alone', () => {
    assert.equal(customerEmailBackfill(null, 'owner@example.com'), 'owner@example.com');
    assert.equal(customerEmailBackfill('billing@example.com', 'owner@example.com'), null);
    assert.equal(customerEmailBackfill(null, '  '), null);
  });
});
