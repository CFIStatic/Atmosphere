import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, type AiAllowance } from '../../lib/api';
import { AiAllowanceSection } from './AiAllowanceSection';

function allowance(partial: Partial<AiAllowance>): AiAllowance {
  return {
    state: 'ok',
    paused: false,
    warning: false,
    message: null,
    usedNanos: 5_000_000_000,
    allowanceNanos: 12_500_000_000,
    usedFraction: 0.4,
    resetAt: '2026-11-01T00:00:00.000Z',
    rolling: { enabled: true, limited: false, hours: 24, usedNanos: 1_000_000_000, capNanos: 3_125_000_000 },
    byFeature: [],
    creditBalanceNanos: 0,
    creditsRollOver: true,
    canManage: true,
    packs: [],
    history: { usage: [], credits: [] },
    ...partial,
  };
}

describe('AI credits card', () => {
  it('never shows allowance dollar amounts, percent, daily cap or a progress bar', () => {
    const { container } = render(
      <AiAllowanceSection
        allowance={allowance({
          state: 'ok',
          usedFraction: 0.4,
          byFeature: [{ feature: 'ask', label: 'Ask', nanos: 2_250_000_000 }],
          history: {
            usage: [{ id: 'u1', at: '2026-10-01T00:00:00.000Z', feature: 'ask', label: 'Ask', nanos: 2_250_000_000 }],
            credits: [],
          },
        })}
        onError={() => {}}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/\$5\.00|\$12\.50|\$2\.25|\$1\.00|\$3\.13/);
    expect(text).not.toMatch(/40%/);
    expect(text).not.toMatch(/Allowance used|Daily limit|This period/i);
    expect(screen.queryByTestId('ai-allowance-meter')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ai-allowance-fill')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ai-allowance-percent')).not.toBeInTheDocument();
    expect(screen.queryByText(/10% annual increase/i)).not.toBeInTheDocument();
  });

  it('keeps the plan and buy-credits actions', () => {
    render(
      <AiAllowanceSection
        allowance={allowance({
          canManage: true,
          packs: [{ code: 'credits_10', label: '$10', cents: 1000, creditNanos: 10_000_000_000, priceConfigured: true }],
        })}
        onError={() => {}}
      />,
    );
    expect(screen.getByTestId('upgrade-plan-scale')).toBeInTheDocument();
    expect(screen.getByTestId('buy-credits-credits_10')).toBeInTheDocument();
  });

  it('still explains a pause without any amounts', () => {
    render(
      <AiAllowanceSection
        allowance={allowance({
          state: 'limited',
          paused: true,
          usedFraction: 1,
          usedNanos: 12_500_000_000,
          message: 'AI is paused until the usage allowance resets.',
        })}
        onError={() => {}}
      />,
    );
    expect(screen.getByTestId('ai-allowance-status')).toHaveTextContent('AI is paused');
    expect(screen.queryByText(/\$12\.50/)).not.toBeInTheDocument();
  });

  it('keeps a yearly plan on the yearly price when switching plans', async () => {
    const checkout = vi.spyOn(api, 'checkoutAiPlan').mockResolvedValue({
      checkoutUrl: null,
      updated: true,
      planCode: 'scale',
      billingInterval: 'year',
    });
    render(
      <AiAllowanceSection
        allowance={allowance({ billingInterval: 'year', canManage: true })}
        onError={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('upgrade-plan-scale'));
    await waitFor(() => expect(checkout).toHaveBeenCalledWith('scale', 'year'));
    checkout.mockRestore();
  });

  it('reloads the allowance and marks the new plan current after an in-place change', async () => {
    const checkout = vi.spyOn(api, 'checkoutAiPlan').mockResolvedValue({
      checkoutUrl: null,
      updated: true,
      planCode: 'scale',
      billingInterval: 'month',
    });
    const onUpdated = vi.fn().mockResolvedValue(undefined);
    render(
      <AiAllowanceSection
        allowance={allowance({ canManage: true })}
        currentPlanCode="starter"
        onError={() => {}}
        onUpdated={onUpdated}
      />,
    );
    fireEvent.click(screen.getByTestId('upgrade-plan-scale'));
    await waitFor(() => {
      expect(onUpdated).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('upgrade-plan-scale')).toBeDisabled();
    });
    expect(screen.getByTestId('plan-change-updated')).toHaveTextContent(/Plan updated/);
    expect(screen.getByTestId('upgrade-plan-starter')).toBeEnabled();
    expect(screen.getByTestId('upgrade-plan-scale')).toHaveTextContent('Scale');
    checkout.mockRestore();
  });
});

describe('AI credits card: no dollar balances, and no purchases in the app', () => {
  afterEach(() => {
    delete document.documentElement.dataset.appShell;
  });

  const withMoney = () =>
    allowance({
      canManage: true,
      creditBalanceNanos: 25_000_000_000,
      packs: [{ code: 'credits_10', label: '$10', cents: 1000, creditNanos: 10_000_000_000, priceConfigured: true }],
      history: {
        usage: [],
        credits: [
          { id: 'c1', at: '2026-10-01T00:00:00.000Z', kind: 'purchase', note: 'AI credits $50 auto-recharge (5000 cents)', deltaNanos: 50_000_000_000 },
        ],
      },
    });

  it('browser: keeps Buy credits but never shows the credit balance or credit dollar amounts', () => {
    const { container } = render(<AiAllowanceSection allowance={withMoney()} onError={() => {}} />);
    expect(screen.queryByTestId('ai-credit-balance')).toBeNull();
    expect(screen.getByTestId('buy-credits-credits_10')).toBeInTheDocument();
    const history = screen.getByTestId('ai-credit-history');
    expect(history.textContent).toContain('Credits purchased');
    expect(history.textContent).not.toMatch(/\$/);
    expect(container.textContent).not.toMatch(/\$25|\$50/);
  });

  it('app: no plan or credit buttons, no dollar amounts, a plain note instead', () => {
    document.documentElement.dataset.appShell = 'ios';
    const { container } = render(
      <AiAllowanceSection
        allowance={{ ...withMoney(), state: 'limited', message: 'AI is paused. Upgrade the plan or buy credits to continue.' }}
        onError={() => {}}
      />,
    );
    expect(screen.queryByText(/Switch to/)).toBeNull();
    expect(screen.queryByText(/Buy/)).toBeNull();
    expect(screen.queryByTestId('ai-credit-history')).toBeNull();
    expect(screen.getByTestId('app-shell-billing-note')).toHaveTextContent(
      'Plans and billing are managed on atmosphereteam.com.',
    );
    expect(container.textContent).not.toMatch(/\$|upgrade|buy credits|stripe|checkout/i);
    expect(container.querySelector('a')).toBeNull();
  });
});
