import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, type AiAutoRecharge } from '../../lib/api';
import tailwindConfig from '../../../tailwind.config.js';
import { AutoRechargeSection } from './AutoRechargeSection';
import source from './AutoRechargeSection.tsx?raw';

const colors = tailwindConfig.theme.extend.colors as Record<string, Record<string, string>>;

function settings(partial: Partial<AiAutoRecharge> = {}): AiAutoRecharge {
  return {
    enabled: false,
    packCode: 'ai_25',
    packs: [
      { code: 'ai_10', label: '$10', cents: 1000, priceConfigured: true },
      { code: 'ai_25', label: '$25', cents: 2500, priceConfigured: true },
      { code: 'ai_50', label: '$50', cents: 5000, priceConfigured: true },
    ],
    available: true,
    canManage: true,
    notice: null,
    cooldownMinutes: 10,
    maxPerDay: 3,
    recent: [],
    ...partial,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Auto-recharge', () => {
  it('is off by default and says credits are bought manually', () => {
    render(<AutoRechargeSection initial={settings()} />);
    const toggle = screen.getByRole('switch', { name: 'Auto-recharge' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('auto-recharge-status')).toHaveTextContent(
      'Off. When your AI credits run out, AI pauses until you buy credits manually.',
    );
    expect(screen.getByTestId('auto-recharge-warning')).toHaveTextContent(
      'Leaving auto-recharge on charges your saved card automatically: one credit pack each time your AI credits run out, up to 3 times in 24 hours. While it is off, nothing is charged automatically.',
    );
  });

  it('asks for agreement to automatic charges before turning on', async () => {
    const update = vi.spyOn(api, 'updateAutoRecharge').mockResolvedValue(settings({ enabled: true, packCode: 'ai_50' }));
    render(<AutoRechargeSection initial={settings()} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Auto-recharge' }));
    expect(update).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('auto-recharge-pack-ai_50'));
    const enable = screen.getByTestId('auto-recharge-enable');
    expect(enable).toHaveTextContent('Turn on auto-recharge ($50)');
    expect(enable).toBeDisabled();
    expect(screen.getByText(/will charge our saved card \$50 automatically each time our AI credits run out/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('auto-recharge-consent'));
    fireEvent.click(enable);
    await waitFor(() => expect(update).toHaveBeenCalledWith({ enabled: true, packCode: 'ai_50', consent: true }));
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Auto-recharge' })).toHaveAttribute('aria-checked', 'true'),
    );
    expect(screen.getByTestId('auto-recharge-status')).toHaveTextContent(
      'On. When your AI credits run out, we charge your saved card $50 and add $50 of credits.',
    );
    expect(screen.getByTestId('auto-recharge-warning')).toHaveTextContent(
      'Leaving auto-recharge on charges your saved card automatically: $50 each time your AI credits run out, up to 3 times in 24 hours. Turn it off at any time to stop automatic charges and buy credits manually instead.',
    );
  });

  it('cancelling the confirmation leaves it off', () => {
    const update = vi.spyOn(api, 'updateAutoRecharge');
    render(<AutoRechargeSection initial={settings()} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Auto-recharge' }));
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByTestId('auto-recharge-confirm')).not.toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it('turns off in one click', async () => {
    const update = vi.spyOn(api, 'updateAutoRecharge').mockResolvedValue(settings({ enabled: false }));
    render(<AutoRechargeSection initial={settings({ enabled: true })} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Auto-recharge' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ enabled: false }));
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Auto-recharge' })).toHaveAttribute('aria-checked', 'false'),
    );
  });

  it('shows the server refusal, such as no saved card', async () => {
    vi.spyOn(api, 'updateAutoRecharge').mockRejectedValue(
      new Error('There is no saved card to charge. Buy credits manually or add a card to your subscription first.'),
    );
    render(<AutoRechargeSection initial={settings()} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Auto-recharge' }));
    fireEvent.click(screen.getByTestId('auto-recharge-consent'));
    fireEvent.click(screen.getByTestId('auto-recharge-enable'));
    expect(await screen.findByTestId('auto-recharge-error')).toHaveTextContent('There is no saved card to charge.');
    expect(screen.getByRole('switch', { name: 'Auto-recharge' })).toHaveAttribute('aria-checked', 'false');
  });

  it('shows the notice after a failed automatic charge and the purchase history', () => {
    render(
      <AutoRechargeSection
        initial={settings({
          notice: { message: 'Your card was declined, so auto-recharge is off. Buy credits manually.', at: '2026-10-03T15:42:00.000Z' },
          recent: [
            { id: 'r2', at: '2026-10-03T15:42:00.000Z', status: 'failed', packCode: 'ai_25', amountCents: 2500, failureMessage: 'declined' },
            { id: 'r1', at: '2026-09-28T19:10:00.000Z', status: 'succeeded', packCode: 'ai_25', amountCents: 2500, failureMessage: null },
          ],
        })}
      />,
    );
    const notice = screen.getByTestId('auto-recharge-notice');
    expect(notice).toHaveAttribute('role', 'alert');
    expect(notice).toHaveTextContent('Auto-recharge was turned off');
    expect(notice).toHaveTextContent('Buy credits manually.');
    const history = screen.getByTestId('auto-recharge-history');
    expect(history).toHaveTextContent('Failed');
    expect(history).toHaveTextContent('Charged $25');
  });

  it('members who are not owners cannot toggle it', () => {
    render(<AutoRechargeSection initial={settings({ canManage: false })} />);
    expect(screen.getByRole('switch', { name: 'Auto-recharge' })).toBeDisabled();
    expect(screen.getByText('Only an owner can turn auto-recharge on or off.')).toBeInTheDocument();
  });

  it('cannot be turned on when no pack price is configured, but can still be turned off', () => {
    const { unmount } = render(<AutoRechargeSection initial={settings({ available: false })} />);
    expect(screen.getByRole('switch', { name: 'Auto-recharge' })).toBeDisabled();
    expect(screen.getByText('Auto-recharge is not available right now. Buy credits manually.')).toBeInTheDocument();
    unmount();
    render(<AutoRechargeSection initial={settings({ available: false, enabled: true })} />);
    expect(screen.getByRole('switch', { name: 'Auto-recharge' })).not.toBeDisabled();
  });

  it('loads from the server when no settings are passed, and hides itself if the server has none', async () => {
    vi.spyOn(api, 'getAutoRecharge').mockResolvedValueOnce(settings({ enabled: true }));
    const { unmount } = render(<AutoRechargeSection />);
    expect(await screen.findByRole('switch', { name: 'Auto-recharge' })).toHaveAttribute('aria-checked', 'true');
    unmount();
    vi.spyOn(api, 'getAutoRecharge').mockRejectedValueOnce(new Error('Not found'));
    const { container } = render(<AutoRechargeSection />);
    await waitFor(() => expect(api.getAutoRecharge).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('shows no allowance amounts, and every colour it uses exists in the theme', () => {
    const { container } = render(<AutoRechargeSection initial={settings({ enabled: true })} />);
    expect(container).not.toHaveTextContent(/allowance|used of|% used/i);
    for (const [, tone, shade] of source.matchAll(/(?:bg|text|border|ring)-(brand|danger|caution|paper|ink)-(\d+)/g)) {
      expect(colors[tone!]?.[shade!], `${tone}-${shade}`).toBeTruthy();
    }
  });
});
