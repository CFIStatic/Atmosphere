import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceBilling } from '../../lib/api';

const getBillingWorkspace = vi.fn();
const getInvoices = vi.fn();
const openBillingPortal = vi.fn();
const addExtraFieldCaptureSeats = vi.fn();
const getTokenUsage = vi.fn();

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getBillingWorkspace: (...args: unknown[]) => getBillingWorkspace(...args),
      getInvoices: (...args: unknown[]) => getInvoices(...args),
      openBillingPortal: (...args: unknown[]) => openBillingPortal(...args),
      addExtraFieldCaptureSeats: (...args: unknown[]) => addExtraFieldCaptureSeats(...args),
      getTokenUsage: (...args: unknown[]) => getTokenUsage(...args),
    },
  };
});

import { BillingSection } from './BillingSection';

const paid: WorkspaceBilling = {
  paymentProvider: 'stripe',
  canManage: true,
  billingExempt: false,
  required: true,
  complete: true,
  isCreator: true,
  subscription: {
    code: 'work_verification',
    name: 'Work Verification',
    baseMonthlyFeeCents: 84900,
    includedJobs: 50,
    additionalJobPriceCents: 3000,
    status: 'active',
    periodStart: '2026-08-01T00:00:00Z',
    periodEnd: '2026-09-01T00:00:00Z',
    cancelAtPeriodEnd: false,
    hasStripeSubscription: true,
    includedFcSeats: 3,
  },
  fieldCaptureSeats: {
    included: 3,
    extra: 0,
    allowed: 3,
    used: 1,
    remaining: 2,
    extraSeatPriceCents: 12500,
  },
  usage: {
    periodStart: '2026-08-01T00:00:00Z',
    periodEnd: '2026-09-01T00:00:00Z',
    planName: 'Work Verification',
    processedJobs: 12,
    includedJobs: 50,
    excessJobs: 0,
    videoVerificationHours: 1,
    computeOverage: null,
    basePlatformChargeCents: 84900,
    jobOverageChargeCents: 0,
    videoProcessingChargeCents: 0,
    estimatedUpcomingBillCents: 84900,
  },
};

const invoice = {
  id: 'in_paid',
  number: 'INV-0008',
  status: 'paid' as const,
  amountCents: 84900,
  currency: 'usd',
  description: 'Work Verification — August',
  hostedInvoiceUrl: 'https://stripe.test/invoice',
  invoicePdfUrl: null,
  createdAt: '2026-08-01T00:05:00Z',
  lines: [
    {
      description: 'Work Verification — August',
      quantity: 1,
      unitAmountCents: 84900,
      amountCents: 84900,
    },
  ],
};

const openInvoice = {
  id: 'in_open',
  number: 'INV-0009',
  status: 'open' as const,
  amountCents: 37,
  currency: 'usd',
  description: 'AI analysis units 2026-09-08',
  hostedInvoiceUrl: 'https://stripe.test/usage',
  invoicePdfUrl: 'https://stripe.test/usage.pdf',
  createdAt: '2026-09-08T16:00:00Z',
  lines: [
    {
      description: 'AI analysis units 2026-09-08',
      quantity: 37,
      unitAmountCents: 1,
      amountCents: 37,
    },
  ],
};

const tokenUsage = {
  periodStart: '2026-08-01T00:00:00Z',
  periodEnd: '2026-09-01T00:00:00Z',
  range: 'period',
  totals: {
    events: 12,
    inputTokens: 80_000,
    outputTokens: 12_000,
    cacheTokens: 4_000,
    totalTokens: 96_000,
    priceNanos: 2_400_000_000,
  },
  byFeature: [],
  byDay: [],
  byEmployee: [],
  recent: [],
};

function renderBilling(path = '/settings?section=billing') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BillingSection />
    </MemoryRouter>,
  );
}

describe('BillingSection', () => {
  beforeEach(() => {
    getBillingWorkspace.mockReset().mockResolvedValue(paid);
    getInvoices.mockReset().mockResolvedValue({ invoices: [invoice], complimentary: false });
    openBillingPortal.mockReset();
    addExtraFieldCaptureSeats.mockReset();
    getTokenUsage.mockReset().mockResolvedValue(tokenUsage);
  });

  it('shows the Work Verification plan, not leftover seat billing', async () => {
    renderBilling();

    expect(await screen.findByRole('heading', { name: 'Work Verification' })).toBeInTheDocument();
    expect(screen.getAllByText('$849').length).toBeGreaterThan(0);
    expect(screen.getByText('/ month')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Plan' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Token usage' })).toBeInTheDocument();
    expect(screen.queryByText(/50 jobs included/)).toBeNull();
    expect(screen.queryByText(/\$30 each/)).toBeNull();
    expect(screen.queryByText(/additional job/i)).toBeNull();
    expect(screen.getByRole('heading', { name: 'Invoices / Receipts' })).toBeInTheDocument();
    expect(screen.getByText('Atmosphere')).toBeInTheDocument();
    expect(screen.getByText('Work Verification — August')).toBeInTheDocument();
    expect(screen.getByText('Qty')).toBeInTheDocument();
    expect(screen.getByText('Unit price')).toBeInTheDocument();
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View receipt' })).toHaveAttribute(
      'href',
      'https://stripe.test/invoice',
    );
    expect(screen.queryByText('jobs processed')).toBeNull();
    expect(screen.queryByText('Job overage')).toBeNull();
    expect(screen.queryByText(/Plan & credits/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Manage plan and payment method' })).toBeInTheDocument();
    expect(screen.getByText(/1 of 3 used/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Field Capture seat — $125/mo' })).toBeNull();
    expect(screen.getByText(/added automatically when you invite/i)).toBeInTheDocument();
  });

  it('shows the Scale plan name and 10 included seats', async () => {
    getBillingWorkspace.mockResolvedValue({
      ...paid,
      subscription: {
        ...paid.subscription,
        code: 'scale',
        name: 'Scale',
        baseMonthlyFeeCents: 199900,
        includedFcSeats: 10,
      },
      fieldCaptureSeats: {
        included: 10,
        extra: 0,
        allowed: 10,
        used: 2,
        remaining: 8,
        extraSeatPriceCents: 12500,
      },
    });

    renderBilling();

    expect(await screen.findByRole('heading', { name: 'Scale' })).toBeInTheDocument();
    expect(screen.getByText(/2 of 10 used/)).toBeInTheDocument();
    expect(screen.getAllByText(/10 included/).length).toBeGreaterThan(0);
    expect(screen.getByText(/\$1,999/)).toBeInTheDocument();
  });

  it('hides paid Stripe controls for a complimentary org', async () => {
    getBillingWorkspace.mockResolvedValue({
      ...paid,
      billingExempt: true,
      subscription: {
        ...paid.subscription,
        status: 'comped',
      },
    });
    getInvoices.mockResolvedValue({ invoices: [], complimentary: true });

    renderBilling();

    expect(await screen.findByText('Comped')).toBeInTheDocument();
    expect(screen.getByText('Complimentary')).toBeInTheDocument();
    expect(screen.queryByText('$849')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Manage plan and payment method' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add Field Capture seat — $125/mo' })).toBeNull();
    expect(screen.getByText('No Stripe invoices — complimentary billing')).toBeInTheDocument();
  });

  it('stacks period details and titles the unpaid state when Stripe is missing', async () => {
    getBillingWorkspace.mockResolvedValue({
      ...paid,
      paymentProvider: 'dev',
      complete: false,
      subscription: {
        ...paid.subscription,
        status: 'incomplete',
        hasStripeSubscription: false,
        periodStart: '2026-08-23T00:00:00Z',
        periodEnd: '2026-09-23T00:00:00Z',
      },
    });
    getInvoices.mockResolvedValue({ invoices: [], complimentary: false });

    renderBilling();

    expect(await screen.findByText('Unpaid')).toBeInTheDocument();
    expect(screen.getByText('Current period')).toBeInTheDocument();
    expect(screen.getByText('Renews')).toBeInTheDocument();
    expect(screen.getByText("Payments aren't available")).toBeInTheDocument();
    expect(screen.getByText(/Stripe is not configured on this server/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Manage plan and payment method' })).toBeNull();
    expect(screen.getByText('No invoices yet.')).toBeInTheDocument();
  });

  it('explains a plan that ends at the period close', async () => {
    getBillingWorkspace.mockResolvedValue({
      ...paid,
      subscription: {
        ...paid.subscription,
        cancelAtPeriodEnd: true,
        periodEnd: '2026-09-01T00:00:00Z',
      },
    });

    renderBilling();

    expect(await screen.findByText('Ends')).toBeInTheDocument();
    expect(screen.getByText('Cancelling')).toBeInTheDocument();
    expect(screen.getByText(/This plan ends on/)).toBeInTheDocument();
  });

  it('lists paid and open Stripe invoices with view links', async () => {
    getInvoices.mockResolvedValue({ invoices: [invoice, openInvoice], complimentary: false });

    renderBilling();

    expect(await screen.findByRole('heading', { name: 'Invoices / Receipts' })).toBeInTheDocument();
    expect(screen.getByText('Work Verification — August')).toBeInTheDocument();
    expect(screen.getByText('AI analysis units 2026-09-08')).toBeInTheDocument();
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('37')).toBeInTheDocument();
    expect(screen.getByText('$0.01')).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: 'View receipt' });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', 'https://stripe.test/invoice');
    expect(links[1]).toHaveAttribute('href', 'https://stripe.test/usage');
  });

  it('hides plan changes from viewers who cannot manage billing', async () => {
    getBillingWorkspace.mockResolvedValue({ ...paid, canManage: false });

    renderBilling();

    expect(await screen.findByText(/Only an owner or billing manager/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Manage plan and payment method' })).toBeNull();
  });
});
