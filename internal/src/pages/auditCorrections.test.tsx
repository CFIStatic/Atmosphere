import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { demoOverview } from '../lib/demo';
import { testDirectory } from '../test/fixtures';
import { resetIncludeInternalForTests, setIncludeInternal } from '../lib/scope';

vi.mock('../hooks/useOverview', () => ({
  useOverview: () => ({ data: demoOverview, error: null, loading: false, reload: vi.fn() }),
}));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u', email: 'staff@example.test', createdAt: '' },
    access: { scope: 'internal', displayName: 'Test Staff', pendingAccessRequests: 0 },
    logout: vi.fn(),
  }),
}));
vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return { ...actual, api: { contacts: vi.fn(), aiBudgets: vi.fn(), grantAiCredits: vi.fn() } };
});

import { api } from '../lib/api';
import { GrowthPage } from './GrowthPage';
import { ContactsPage } from './ContactsPage';
import { AiBudgetsPage } from './AiBudgetsPage';
import { Shell } from '../components/Shell';

const wrap = (ui: React.ReactNode) => render(<MemoryRouter initialEntries={['/overview']}>{ui}</MemoryRouter>);

describe('analytics audit corrections (TEST DATA)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetIncludeInternalForTests();
  });

  it('Revenue: honest AI cost labels, paying delta on paying orgs, collected revenue split', () => {
    wrap(<GrowthPage />);
    expect(screen.getByText(/AI cost at list markup \(not invoiced\)/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Usage billed to customers/);
    expect(document.body.textContent).not.toMatch(/Gross margin/);
    expect(screen.getByText('vs 10 at month start')).toBeInTheDocument();
    expect(screen.getByText('Collected, net')).toBeInTheDocument();
    expect(screen.getByText('Refunds')).toBeInTheDocument();
    expect(screen.getByText(/Field Capture seats$/)).toBeInTheDocument();
  });

  it('Shell: the internal toggle is off by default, Experiments is hidden, and the scope is labelled', () => {
    wrap(<Shell />);
    const toggle = screen.getByTestId('include-internal-toggle');
    expect(toggle).not.toBeChecked();
    expect(screen.queryByRole('link', { name: 'Experiments' })).toBeNull();
    expect(screen.getByTestId('scope-note')).toHaveTextContent(/Customers only/);
    expect(screen.getByTestId('scope-note')).toHaveTextContent(/UTC/);
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
    expect(screen.getByTestId('scope-note')).toHaveTextContent(/Including internal/);
  });

  it('Contacts: canceled is its own count; internal contacts follow the toggle', async () => {
    vi.mocked(api.contacts).mockResolvedValue({
      ...testDirectory,
      contacts: [
        ...testDirectory.contacts,
        { email: 'staff@jettx.ai', name: 'Staff', company: 'Jettx', orgId: null, plan: 'scale', status: 'active', createdAt: null, sources: ['stripe'], suppressed: false, internal: true },
      ],
    });
    const { unmount } = wrap(<ContactsPage />);
    await waitFor(() => expect(screen.getByText('avery.ops@example.test')).toBeInTheDocument());
    expect(screen.queryByText('staff@jettx.ai')).toBeNull();
    expect(screen.getByText('1 internal hidden')).toBeInTheDocument();
    const strip = screen.getByTestId('kpi-strip');
    expect(within(strip).getByText('Canceled')).toBeInTheDocument();
    expect(within(strip).getByText('No subscription')).toBeInTheDocument();
    unmount();

    setIncludeInternal(true);
    wrap(<ContactsPage />);
    await waitFor(() => expect(screen.getByText('staff@jettx.ai')).toBeInTheDocument());
    expect(screen.getAllByText('Internal').length).toBeGreaterThan(0);
  });

  it('AI budgets: allowance from what the org pays, comp and $0, no 2126 reset', async () => {
    const window = { from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' };
    const base = { state: 'ok', paused: false, usedNanos: 0, allowanceNanos: 0, usedFraction: 0, creditBalanceNanos: 0, resetAt: null };
    vi.mocked(api.aiBudgets).mockResolvedValue({
      allowanceFraction: 0.1,
      costWindow: { ...window, timeZone: 'UTC' },
      budgets: [
        {
          ...base,
          orgId: 'a',
          orgName: 'Test Restoration Co (TEST DATA)',
          staff: { billingClass: 'paying', paidMonthlyCents: 84_900, paidSource: 'stripe', allowanceMonthlyNanos: 84_900_000_000, allowanceLabel: '$84.90', periodNote: null, displayResetAt: '2026-11-01T00:00:00Z', usedOfAllowancePct: 50, aiCostNanos: 42_450_000_000, costWindow: window },
        },
        {
          ...base,
          orgId: 'b',
          orgName: 'Comp Org (TEST DATA)',
          internal: true,
          staff: { billingClass: 'comp', paidMonthlyCents: 0, paidSource: null, allowanceMonthlyNanos: null, allowanceLabel: 'comp', periodNote: 'no_reset_comp_term', displayResetAt: null, usedOfAllowancePct: null, aiCostNanos: 1_000_000_000, costWindow: window },
        },
        {
          ...base,
          orgId: 'c',
          orgName: 'Trial Org (TEST DATA)',
          staff: { billingClass: 'trialing', paidMonthlyCents: 0, paidSource: null, allowanceMonthlyNanos: 0, allowanceLabel: '$0', periodNote: 'ended_awaiting_renewal', displayResetAt: null, usedOfAllowancePct: null, aiCostNanos: 0, costWindow: window },
        },
      ],
    });
    wrap(<AiBudgetsPage />);
    await waitFor(() => expect(screen.getByText('Test Restoration Co (TEST DATA)')).toBeInTheDocument());
    expect(screen.getByText('$84.90')).toBeInTheDocument();
    expect(screen.getByText('comp')).toBeInTheDocument();
    expect(screen.getByText('$0')).toBeInTheDocument();
    expect(screen.getByText('No reset (comp term)')).toBeInTheDocument();
    expect(screen.getByText('Period ended, awaiting renewal')).toBeInTheDocument();
    expect(screen.getByRole('table').textContent).not.toContain('2126');
  });
});
