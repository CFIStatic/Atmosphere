import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getBillingOnboarding = vi.fn();
const startOnboardingCheckout = vi.fn();

vi.mock('../../lib/api', () => ({
  api: {
    getBillingOnboarding: (...args: unknown[]) => getBillingOnboarding(...args),
    startOnboardingCheckout: (...args: unknown[]) => startOnboardingCheckout(...args),
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
  defaultPlanCode: 'work_verification' as const,
  plans: [
    { code: 'starter' as const, name: 'Starter', monthlyCents: 39900, includedFcSeats: 1, recommended: false },
    {
      code: 'work_verification' as const,
      name: 'Work Verification',
      monthlyCents: 84900,
      includedFcSeats: 3,
      recommended: true,
      defaultSelected: true,
    },
    { code: 'scale' as const, name: 'Scale', monthlyCents: 199900, includedFcSeats: 10, recommended: false },
  ],
  plan: {
    name: 'Work Verification',
    baseMonthlyFeeCents: 84900,
    includedJobs: 50,
    additionalJobPriceCents: 3000,
    includedFcSeats: 3,
  },
  fieldCaptureSeats: {
    included: 3,
    extra: 0,
    allowed: 3,
    used: 0,
    remaining: 3,
    extraSeatPriceCents: 12500,
  },
};

function renderBilling(path = '/signup?step=2') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SetupBillingStep redirectTo="/jobs" checkoutOutcome={null} onComplete={() => undefined} />
    </MemoryRouter>,
  );
}

describe('SetupBillingStep', () => {
  beforeEach(() => {
    getBillingOnboarding.mockReset();
    getBillingOnboarding.mockResolvedValue(unpaid);
    startOnboardingCheckout.mockReset().mockResolvedValue({ checkoutUrl: null });
  });

  it('shows the plan price without extra payment copy', async () => {
    renderBilling();

    expect(await screen.findByRole('button', { name: 'Continue to Stripe' })).toBeInTheDocument();
    expect(screen.getByText('Work Verification')).toBeInTheDocument();
    expect(screen.getByText('Starter')).toBeInTheDocument();
    expect(screen.getByText('Scale')).toBeInTheDocument();
    expect(screen.getAllByText('/ month')).toHaveLength(3);
    expect(screen.getByText('$399')).toBeInTheDocument();
    expect(screen.getByText('$849')).toBeInTheDocument();
    expect(screen.getByText('$1,999')).toBeInTheDocument();
    expect(screen.getByText('1 Field Capture account')).toBeInTheDocument();
    expect(screen.getByText('3 Field Capture accounts')).toBeInTheDocument();
    expect(screen.getByText('10 Field Capture accounts')).toBeInTheDocument();
    expect(screen.getByText('Recommended')).toBeInTheDocument();
    expect(screen.queryByText(/processed jobs/i)).toBeNull();
    expect(screen.queryByText(/Card details never touch/i)).toBeNull();
    expect(screen.queryByText(/Cancel anytime/i)).toBeNull();
    expect(screen.queryByText(/Field Capture \+ Evidence Platform/i)).toBeNull();
  });

  it('defaults to Work Verification and checks out the selected plan', async () => {
    const user = userEvent.setup();
    renderBilling();

    expect(await screen.findByRole('radio', { name: /Work Verification/i })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: /Starter/i }));
    await user.click(screen.getByRole('button', { name: 'Continue to Stripe' }));
    expect(startOnboardingCheckout).toHaveBeenCalledWith('/jobs', 'starter');
  });

  it('preselects a plan from the signup URL', async () => {
    renderBilling('/signup?step=2&plan=scale');
    expect(await screen.findByRole('radio', { name: /Scale/i })).toBeChecked();
  });
});
