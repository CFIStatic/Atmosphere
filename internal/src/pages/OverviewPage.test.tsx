import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { OverviewPage } from './OverviewPage';
import { demoOverview } from '../lib/demo';
import { testHealth } from '../test/fixtures';

vi.mock('../hooks/useOverview', () => ({
  useOverview: () => ({ data: demoOverview, error: null, loading: false, reload: vi.fn() }),
}));
vi.mock('../hooks/useProductHealth', () => ({
  useProductHealth: () => ({ data: testHealth, error: null, loading: false, reload: vi.fn() }),
}));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ access: { scope: 'internal', displayName: 'Test Staff', pendingAccessRequests: 0 } }),
}));

function renderOverview() {
  return render(
    <MemoryRouter>
      <OverviewPage />
    </MemoryRouter>,
  );
}

describe('OverviewPage', () => {
  it('is a one-screen summary: north star, six linked KPIs and an as-of stamp', () => {
    renderOverview();
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByTestId('as-of').textContent).toMatch(/As of/);
    expect(screen.getByTestId('north-star-value').textContent).toBe('2.00');
    expect(screen.getByRole('link', { name: 'Hours filmed per paying seat' })).toHaveAttribute('href', '/north-star');
    expect(screen.getByRole('img', { name: 'Hours filmed per paying seat by week' })).toBeInTheDocument();

    const strip = screen.getByTestId('kpi-strip');
    const links = within(strip).getAllByRole('link');
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['MRR', '/growth'],
      ['Paying organizations', '/growth'],
      ['Upload completion', '/capture'],
      ['Time to analysis', '/capture'],
      ['Evidence delivered', '/capture'],
      ['Ask error rate', '/ai'],
    ]);
  });

  it('leaves tables, drill-downs and long definitions to the detail pages', () => {
    renderOverview();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText('Health signals')).toBeNull();
    expect(screen.queryByText('Drill-downs')).toBeNull();
    expect(screen.queryByText('Sources and definitions')).toBeNull();
    expect(screen.queryByText(/waiting for access/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/product intelligence/i);
    expect(document.body.textContent).not.toMatch(/10% annual/i);
  });
});
