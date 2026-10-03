import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TokenUsagePage } from './TokenUsagePage';

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return {
    ...actual,
    api: {
      tokenUsage: vi.fn(),
    },
  };
});

import { api } from '../lib/api';

describe('TokenUsagePage', () => {
  beforeEach(() => {
    vi.mocked(api.tokenUsage).mockReset();
  });

  it('shows an honest empty state when the ledger has no rows', async () => {
    vi.mocked(api.tokenUsage).mockResolvedValue({
      totals: {
        eventCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheTokens: 0,
        totalTokens: 0,
        priceNanos: 0,
        costNanos: 0,
        distinctOrgs: 0,
        distinctUsers: 0,
        distinctModels: 0,
      },
      byCustomer: [],
      byUser: [],
      byModel: [],
      byFeature: [],
    });

    render(<TokenUsagePage />);
    expect(await screen.findByText(/No token usage in this window/i)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Last 30 days/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('renders customer and model breakdowns from the ledger', async () => {
    vi.mocked(api.tokenUsage).mockResolvedValue({
      totals: {
        eventCount: 2,
        inputTokens: 1000,
        outputTokens: 200,
        cacheTokens: 0,
        totalTokens: 1200,
        priceNanos: 10_000_000,
        costNanos: 1_000_000,
        distinctOrgs: 1,
        distinctUsers: 1,
        distinctModels: 1,
      },
      byCustomer: [
        {
          orgId: 'o1',
          orgName: 'Acme Builders',
          eventCount: 2,
          inputTokens: 1000,
          outputTokens: 200,
          cacheTokens: 0,
          totalTokens: 1200,
          priceNanos: 10_000_000,
          distinctUsers: 1,
          distinctModels: 1,
        },
      ],
      byUser: [
        {
          userId: 'u1',
          userName: 'Ada',
          email: 'ada@acme.test',
          orgId: 'o1',
          orgName: 'Acme Builders',
          eventCount: 2,
          inputTokens: 1000,
          outputTokens: 200,
          cacheTokens: 0,
          totalTokens: 1200,
          priceNanos: 10_000_000,
        },
      ],
      byModel: [
        {
          model: 'claude-opus-5',
          eventCount: 2,
          inputTokens: 1000,
          outputTokens: 200,
          cacheTokens: 0,
          totalTokens: 1200,
          priceNanos: 10_000_000,
          distinctOrgs: 1,
          distinctUsers: 1,
        },
      ],
      byFeature: [{ feature: 'ask', eventCount: 2, totalTokens: 1200, priceNanos: 10_000_000 }],
    });

    render(<TokenUsagePage />);
    await waitFor(() => expect(screen.getAllByText('Acme Builders').length).toBeGreaterThan(0));
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('claude-opus-5')).toBeInTheDocument();
    expect(screen.getByText('Ask')).toBeInTheDocument();
  });

  it('shows the window label and flags unpriced calls loudly', async () => {
    vi.mocked(api.tokenUsage).mockResolvedValue({
      window: { from: '2026-09-02T00:00:00Z', to: '2026-10-02T00:00:00Z', label: 'Rolling 30 days (UTC)', timeZone: 'UTC' },
      pricing: { rule: 'price = provider cost × customer markup', rateCardVerifiedAt: '2026-10-02' },
      health: { repricedEvents: 0, unpricedEvents: 3, unpricedModels: [{ model: 'mystery-model', events: 3 }], ok: false },
      totals: {
        eventCount: 3,
        inputTokens: 10,
        outputTokens: 1,
        cacheTokens: 0,
        totalTokens: 11,
        priceNanos: 0,
        costNanos: 0,
        distinctOrgs: 1,
        distinctUsers: 0,
        distinctModels: 1,
      },
      byCustomer: [],
      byUser: [],
      byModel: [],
      byFeature: [],
    });
    render(<TokenUsagePage />);
    expect(await screen.findByTestId('token-usage-window')).toHaveTextContent('Rolling 30 days (UTC)');
    expect(screen.getByRole('alert')).toHaveTextContent('mystery-model (3)');
  });
});
