import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TokenTotals, TokenUsageReport } from '../../lib/api';
import { emptyTokenTotals } from './tokenUsageModel';

const getTokenUsage = vi.fn();

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getTokenUsage: (...args: unknown[]) => getTokenUsage(...args),
    },
  };
});

import { TokenUsageSection } from './TokenUsageSection';

const totals = (partial: Partial<TokenTotals>): TokenTotals => ({
  ...emptyTokenTotals(),
  ...partial,
});

const report: TokenUsageReport = {
  periodStart: '2026-08-01T00:00:00Z',
  periodEnd: '2026-09-01T00:00:00Z',
  range: 'period',
  totals: totals({
    events: 48,
    inputTokens: 240_000,
    outputTokens: 36_000,
    cacheTokens: 12_000,
    totalTokens: 288_000,
    priceNanos: 18_400_000_000,
  }),
  byFeature: [
    { feature: 'video_analysis', ...totals({ events: 20, totalTokens: 180_000, priceNanos: 12_000_000_000 }) },
    { feature: 'chat', ...totals({ events: 18, totalTokens: 70_000, priceNanos: 4_400_000_000 }) },
    { feature: 'ask', ...totals({ events: 10, totalTokens: 38_000, priceNanos: 2_000_000_000 }) },
    { feature: 'other', ...emptyTokenTotals() },
  ],
  byDay: [
    {
      day: '2026-08-01',
      ...totals({ totalTokens: 40_000 }),
      byFeature: {
        video_analysis: totals({ totalTokens: 28_000 }),
        chat: totals({ totalTokens: 8_000 }),
        ask: totals({ totalTokens: 4_000 }),
        other: emptyTokenTotals(),
      },
    },
    {
      day: '2026-08-02',
      ...totals({ totalTokens: 55_000 }),
      byFeature: {
        video_analysis: totals({ totalTokens: 30_000 }),
        chat: totals({ totalTokens: 15_000 }),
        ask: totals({ totalTokens: 10_000 }),
        other: emptyTokenTotals(),
      },
    },
  ],
  byEmployee: [
    {
      userId: 'u-1',
      name: 'Elena Ortiz',
      email: 'elena@ortizrestoration.com',
      role: 'global_admin',
      roleLabel: 'Global Admin',
      ...totals({ totalTokens: 190_000, priceNanos: 12_200_000_000 }),
      byFeature: {
        video_analysis: totals({ totalTokens: 140_000 }),
        chat: totals({ totalTokens: 30_000 }),
        ask: totals({ totalTokens: 20_000 }),
        other: emptyTokenTotals(),
      },
    },
    {
      userId: 'u-2',
      name: 'Marcus Chen',
      email: 'marcus@ortizrestoration.com',
      role: 'employee',
      roleLabel: 'Employee',
      ...totals({ totalTokens: 98_000, priceNanos: 6_200_000_000 }),
      byFeature: {
        video_analysis: totals({ totalTokens: 40_000 }),
        chat: totals({ totalTokens: 40_000 }),
        ask: totals({ totalTokens: 18_000 }),
        other: emptyTokenTotals(),
      },
    },
  ],
  recent: [
    {
      id: 'r-1',
      createdAt: '2026-08-02T16:00:00Z',
      feature: 'ask',
      source: 'proof_ask',
      modelId: 'claude-sonnet',
      userId: 'u-1',
      userName: 'Elena Ortiz',
      inputTokens: 1400,
      outputTokens: 320,
      cacheTokens: 0,
      totalTokens: 1720,
      priceNanos: 80_000_000,
    },
  ],
};

describe('TokenUsageSection', () => {
  beforeEach(() => {
    getTokenUsage.mockReset().mockResolvedValue(report);
  });

  it('shows org totals, the graph, metering, and a per-employee breakdown', async () => {
    render(<TokenUsageSection />);

    expect(await screen.findByRole('heading', { name: 'Token usage' })).toBeInTheDocument();
    expect(screen.getByText('288k')).toBeInTheDocument();
    expect(screen.getByText('$18.40')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /token usage by day/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Metering' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'By employee' })).toBeInTheDocument();
    expect(screen.getAllByText('Elena Ortiz').length).toBeGreaterThan(0);
    expect(screen.getByText('Marcus Chen')).toBeInTheDocument();
    expect(screen.getByText('Global Admin · elena@ortizrestoration.com · 66% of org')).toBeInTheDocument();
    expect(screen.getAllByText('Ask').length).toBeGreaterThan(0);
    expect(screen.getByText('claude-sonnet')).toBeInTheDocument();
  });

  it('reloads when the window changes', async () => {
    const user = userEvent.setup();
    render(<TokenUsageSection />);
    await screen.findByRole('heading', { name: 'Token usage' });
    expect(getTokenUsage).toHaveBeenCalledWith('period');

    await user.click(screen.getByRole('tab', { name: 'Last 30 days' }));
    expect(getTokenUsage).toHaveBeenCalledWith('30d');
  });
});
