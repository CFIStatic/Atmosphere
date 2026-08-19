import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getBillingOnboarding = vi.fn();

vi.mock('../../lib/api', () => ({
  api: {
    getBillingOnboarding: (...args: unknown[]) => getBillingOnboarding(...args),
    startOnboardingCheckout: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status = 400;
    code = 'billing_failed';
  },
}));

import { SetupBillingStep } from './SetupBillingStep';

const unpaid = {
  required: true,
  complete: false,
  plan: {
    name: 'Work Verification',
    baseMonthlyFeeCents: 59900,
    includedJobs: 50,
    additionalJobPriceCents: 3000,
  },
};

describe('SetupBillingStep', () => {
  beforeEach(() => {
    getBillingOnboarding.mockReset();
    getBillingOnboarding.mockResolvedValue(unpaid);
  });

  it('shows the plan price without extra payment copy', async () => {
    render(
      <SetupBillingStep redirectTo="/jobs" checkoutOutcome={null} onComplete={() => undefined} />,
    );

    expect(await screen.findByRole('button', { name: 'Continue' })).toBeInTheDocument();
    expect(screen.getByText(/\/ month/)).toBeInTheDocument();
    expect(screen.queryByText(/processed jobs/i)).toBeNull();
    expect(screen.queryByText(/Card details never touch/i)).toBeNull();
    expect(screen.queryByText(/Cancel anytime/i)).toBeNull();
    expect(screen.queryByText(/Work Verification/i)).toBeNull();
  });
});
