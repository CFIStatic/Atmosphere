import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api, type AiAllowance } from '../../lib/api';
import tailwindConfig from '../../../tailwind.config.js';
import { AiAllowanceSection } from './AiAllowanceSection';

const colors = tailwindConfig.theme.extend.colors as Record<string, Record<string, string>>;

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

function expectFill(width: string, tone: 'brand' | 'caution' | 'danger', shade: string) {
  const fill = screen.getByTestId('ai-allowance-fill');
  expect(fill).toHaveStyle({ width });
  expect(fill.className).toContain(`bg-${tone}-${shade}`);
  expect(colors[tone]?.[shade]).toBeTruthy();
}

describe('AI allowance meter', () => {
  it('labels the meter as allowance used at our AI cost, not the billed price', () => {
    render(<AiAllowanceSection allowance={allowance({ state: 'ok', usedFraction: 0.4 })} onError={() => {}} />);
    expect(screen.getByTestId('ai-allowance-label')).toHaveTextContent('Allowance used (at our AI cost)');
    expect(screen.queryByText(/10% annual increase/i)).not.toBeInTheDocument();
  });

  it('fills the bar for normal use, the warning, and the limit', () => {
    const { rerender } = render(
      <AiAllowanceSection allowance={allowance({ state: 'ok', usedFraction: 0.4 })} onError={() => {}} />,
    );
    expectFill('40%', 'brand', '600');

    rerender(
      <AiAllowanceSection
        allowance={allowance({
          state: 'warning',
          warning: true,
          usedFraction: 0.8,
          usedNanos: 10_000_000_000,
          message: 'This account has used most of its AI allowance for this period.',
        })}
        onError={() => {}}
      />,
    );
    expectFill('80%', 'caution', '600');

    rerender(
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
    expectFill('100%', 'danger', '600');
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
