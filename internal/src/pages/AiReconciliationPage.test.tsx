import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AiReconciliationPage, usd } from './AiReconciliationPage';

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return { ...actual, api: { aiReconciliation: vi.fn() } };
});

import { api } from '../lib/api';

describe('AiReconciliationPage', () => {
  it('shows not-connected providers with what they need, and flags variance over 2%', async () => {
    vi.mocked(api.aiReconciliation).mockResolvedValue({
      generatedAt: '2026-10-02T12:00:00Z',
      window: { from: '2026-09-02T00:00:00Z', to: '2026-10-02T00:00:00Z', timeZone: 'UTC' },
      thresholdPct: 2,
      flaggedCount: 1,
      providers: [
        {
          provider: 'anthropic',
          label: 'Anthropic (Claude)',
          status: 'connected',
          requires: [],
          source: 'Anthropic Admin API',
          note: null,
          error: null,
          days: [
            { day: '2026-09-29', oursUsd: 1, theirsUsd: 1, varianceUsd: 0, variancePct: 0, flagged: false, pending: false },
            { day: '2026-09-30', oursUsd: 0.9, theirsUsd: 1, varianceUsd: -0.1, variancePct: -10, flagged: true, pending: false },
          ],
          totals: { oursUsd: 1.9, theirsUsd: 2, varianceUsd: -0.1, variancePct: -5, flagged: true },
        },
        {
          provider: 'google',
          label: 'Google (Gemini API)',
          status: 'not_connected',
          requires: ['GOOGLE_BILLING_EXPORT_TABLE (project.dataset.table)'],
          source: 'Cloud Billing export',
          note: null,
          error: null,
          days: [{ day: '2026-09-30', oursUsd: 0.25, theirsUsd: null, varianceUsd: null, variancePct: null, flagged: false, pending: false }],
          totals: { oursUsd: 0.25, theirsUsd: null, varianceUsd: null, variancePct: null, flagged: false },
        },
      ],
    });
    render(<AiReconciliationPage />);
    const google = await screen.findByTestId('recon-google');
    expect(within(google).getByTestId('recon-status')).toHaveTextContent('Not connected');
    expect(within(google).getByTestId('recon-requires')).toHaveTextContent('GOOGLE_BILLING_EXPORT_TABLE');
    const anthropic = screen.getByTestId('recon-anthropic');
    expect(within(anthropic).getByText('−10.00%')).toBeInTheDocument();
    expect(anthropic.querySelectorAll('[data-flagged="true"]').length).toBe(1);
    expect(screen.getByTestId('recon-window')).toHaveTextContent('Rolling 30 days (UTC)');
  });

  it('formats sub-dollar cost with four places', () => {
    expect(usd(0.5837763)).toBe('$0.5838');
    expect(usd(12.5)).toBe('$12.50');
    expect(usd(null)).toBe('—');
  });
});
