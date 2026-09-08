import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { centsToNanos } from './money.js';
import {
  alreadyInvoicedSameDayCents,
  enqueueSameDayUsage,
  invoiceSameDayUsageCharge,
  isSameDayUsageInvoice,
  sameDayUsageChargeCents,
  usageDayUtc,
  type SameDayUsageStripe,
} from './stripeSameDayUsage.js';

describe('same-day usage charge math', () => {
  it('converts price_nanos to leftover cents after prior invoices', () => {
    assert.equal(sameDayUsageChargeCents(centsToNanos(125), 0), 125);
    assert.equal(sameDayUsageChargeCents(centsToNanos(125), 80), 45);
    assert.equal(sameDayUsageChargeCents(centsToNanos(80), 80), 0);
    assert.equal(sameDayUsageChargeCents(4_999_999, 0), 0);
    assert.equal(sameDayUsageChargeCents(5_000_000, 0), 1);
  });

  it('matches invoices for that org and UTC day', () => {
    assert.equal(
      isSameDayUsageInvoice(
        { metadata: { org_id: 'org-1', kind: 'same_day_usage', usage_day: '2026-09-07' } },
        'org-1',
        '2026-09-07',
      ),
      true,
    );
    assert.equal(
      isSameDayUsageInvoice(
        { metadata: { org_id: 'org-1', kind: 'metering_overage', usage_day: '2026-09-07' } },
        'org-1',
        '2026-09-07',
      ),
      false,
    );
    assert.equal(usageDayUtc('2026-09-07T18:04:00.000Z'), '2026-09-07');
  });

  it('sums paid or open same-day invoices only', () => {
    const cents = alreadyInvoicedSameDayCents(
      [
        {
          metadata: { org_id: 'org-1', kind: 'same_day_usage', usage_day: '2026-09-07' },
          status: 'paid',
          amount_paid: 40,
        },
        {
          metadata: { org_id: 'org-1', kind: 'same_day_usage', usage_day: '2026-09-07' },
          status: 'draft',
          amount_due: 99,
        },
        {
          metadata: { org_id: 'org-1', kind: 'same_day_usage', usage_day: '2026-09-06' },
          status: 'paid',
          amount_paid: 10,
        },
      ],
      'org-1',
      '2026-09-07',
    );
    assert.equal(cents, 40);
  });
});

function mockStripe() {
  const calls: Array<{ name: string; args: unknown }> = [];
  const stripe: SameDayUsageStripe = {
    invoices: {
      async list() {
        return { data: [], has_more: false } as never;
      },
      async create(params) {
        calls.push({ name: 'invoices.create', args: params });
        return {
          id: 'in_same_day',
          status: 'draft',
          lines: { data: [] },
          metadata: params.metadata,
        } as never;
      },
      async finalizeInvoice(id) {
        calls.push({ name: 'invoices.finalizeInvoice', args: id });
        return { id, status: 'open', lines: { data: [{ id: 'il_1' }] } } as never;
      },
      async pay(id) {
        calls.push({ name: 'invoices.pay', args: id });
        return { id, status: 'paid' } as never;
      },
      async del(id) {
        calls.push({ name: 'invoices.del', args: id });
        return { id, deleted: true };
      },
    },
    invoiceItems: {
      async create(params) {
        calls.push({ name: 'invoiceItems.create', args: params });
        return { id: 'ii_1' } as never;
      },
    },
  };
  return { stripe, calls };
}

describe('same-day usage invoice path', () => {
  it('creates an invoice item, finalizes, and pays leftover cents', async () => {
    const { stripe, calls } = mockStripe();
    const result = await invoiceSameDayUsageCharge(stripe, {
      customerId: 'cus_1',
      orgId: 'org-1',
      day: '2026-09-07',
      billableNanos: centsToNanos(37),
      existingInvoices: [],
    });

    assert.equal(result.skipped, null);
    assert.equal(result.invoiceId, 'in_same_day');
    assert.equal(result.amountCents, 37);
    assert.deepEqual(
      calls.map((c) => c.name),
      ['invoices.create', 'invoiceItems.create', 'invoices.finalizeInvoice', 'invoices.pay'],
    );
    const item = calls.find((c) => c.name === 'invoiceItems.create')?.args as { amount: number };
    assert.equal(item.amount, 37);
    const created = calls.find((c) => c.name === 'invoices.create')?.args as {
      metadata: { kind: string; usage_day: string };
      collection_method?: string;
    };
    assert.equal(created.metadata.kind, 'same_day_usage');
    assert.equal(created.metadata.usage_day, '2026-09-07');
    assert.equal(created.collection_method, 'charge_automatically');
  });

  it('skips when the day is already invoiced for that amount', async () => {
    const { stripe, calls } = mockStripe();
    const result = await invoiceSameDayUsageCharge(stripe, {
      customerId: 'cus_1',
      orgId: 'org-1',
      day: '2026-09-07',
      billableNanos: centsToNanos(37),
      existingInvoices: [
        {
          metadata: { org_id: 'org-1', kind: 'same_day_usage', usage_day: '2026-09-07' },
          status: 'paid',
          amount_paid: 37,
        } as never,
      ],
    });
    assert.equal(result.skipped, 'already_invoiced');
    assert.equal(result.invoiceId, null);
    assert.equal(calls.length, 0);
  });

  it('invoices only the leftover when more usage arrives the same day', async () => {
    const { stripe, calls } = mockStripe();
    const result = await invoiceSameDayUsageCharge(stripe, {
      customerId: 'cus_1',
      orgId: 'org-1',
      day: '2026-09-07',
      billableNanos: centsToNanos(90),
      existingInvoices: [
        {
          metadata: { org_id: 'org-1', kind: 'same_day_usage', usage_day: '2026-09-07' },
          status: 'paid',
          amount_paid: 37,
        } as never,
      ],
    });
    assert.equal(result.amountCents, 53);
    const item = calls.find((c) => c.name === 'invoiceItems.create')?.args as { amount: number };
    assert.equal(item.amount, 53);
  });

  it('voids a draft when a concurrent invoice already covers the day', async () => {
    const { stripe, calls } = mockStripe();
    const result = await invoiceSameDayUsageCharge(stripe, {
      customerId: 'cus_1',
      orgId: 'org-1',
      day: '2026-09-07',
      billableNanos: centsToNanos(40),
      existingInvoices: [],
      refreshInvoices: async () => [
        {
          id: 'in_other',
          metadata: { org_id: 'org-1', kind: 'same_day_usage', usage_day: '2026-09-07' },
          status: 'paid',
          amount_paid: 40,
        } as never,
      ],
    });
    assert.equal(result.skipped, 'coalesced');
    assert.equal(result.invoiceId, null);
    assert.equal(calls.some((c) => c.name === 'invoices.del'), true);
    assert.equal(calls.some((c) => c.name === 'invoices.pay'), false);
  });
});

describe('same-day usage lock', () => {
  it('runs overlapping org+day work one after another', async () => {
    const order: string[] = [];
    const first = enqueueSameDayUsage('org-1', '2026-09-07', async () => {
      order.push('a-start');
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push('a-end');
      return 1;
    });
    const second = enqueueSameDayUsage('org-1', '2026-09-07', async () => {
      order.push('b');
      return 2;
    });
    assert.deepEqual(await Promise.all([first, second]), [1, 2]);
    assert.deepEqual(order, ['a-start', 'a-end', 'b']);
  });
});
