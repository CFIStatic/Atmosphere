import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceBilling } from '../../lib/api';

const getBillingWorkspace = vi.fn();
const getPayments = vi.fn();
const openBillingPortal = vi.fn();
const getTokenUsage = vi.fn();

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getBillingWorkspace: (...args: unknown[]) => getBillingWorkspace(...args),
      getPayments: (...args: unknown[]) => getPayments(...args),
      openBillingPortal: (...args: unknown[]) => openBillingPortal(...args),
      getTokenUsage: (...args: unknown[]) => getTokenUsage(...args),
    },
  };
});

import { BillingSection } from './BillingSection';

const paid: WorkspaceBilling = {
  paymentProvider: 'stripe',
  canManage: true,
  required: true,
  complete: true,
  isCreator: true,
  subscription: {
    name: 'Work Verification',
    baseMonthlyFeeCents: 59900,
    includedJobs: 50,
    additionalJobPriceCents: 3000,
    status: 'active',
    periodStart: '2026-08-01T00:00:00Z',
    periodEnd: '2026-09-01T00:00:00Z',
    cancelAtPeriodEnd: false,
    hasStripeSubscription: true,
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
    basePlatformChargeCents: 59900,
    jobOverageChargeCents: 0,
    videoProcessingChargeCents: 0,
    estimatedUpcomingBillCents: 59900,
  },
};

describe('BillingSection', () => {
  beforeEach(() => {
    getBillingWorkspace.mockReset().mockResolvedValue(paid);
    getPayments.mockReset().mockResolvedValue({
      payments: [
        {
          id: 'pay-1',
          kind: 'subscription',
          status: 'succeeded',
          amountCents: 59900,
          currency: 'usd',
          description: 'Work Verification — August',
          receiptUrl: null,
          hostedInvoiceUrl: 'https://stripe.test/invoice',
          invoicePdfUrl: null,
          receiptEmail: 'owner@example.com',
          cardBrand: 'visa',
          cardLast4: '4242',
          periodStart: '2026-08-01T00:00:00Z',
          periodEnd: '2026-09-01T00:00:00Z',
          failureReason: null,
          createdAt: '2026-08-01T00:05:00Z',
        },
      ],
    });
    openBillingPortal.mockReset();
    getTokenUsage.mockReset().mockResolvedValue({
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
    });
  });

  it('shows the Work Verification plan, not leftover seat billing', async () => {
    render(
      <MemoryRouter>
        <BillingSection />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Work Verification' })).toBeInTheDocument();
    expect(screen.getByText(/50 jobs included/)).toBeInTheDocument();
    expect(screen.getByText('Work Verification — August')).toBeInTheDocument();
    expect(screen.queryByText('This period')).toBeNull();
    expect(screen.queryByText('jobs processed')).toBeNull();
    expect(screen.queryByText('Job overage')).toBeNull();
    expect(screen.queryByText(/seat/i)).toBeNull();
    expect(screen.queryByText(/Plan & credits/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Manage plan and payment method' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Token usage' })).toBeInTheDocument();
  });
});
