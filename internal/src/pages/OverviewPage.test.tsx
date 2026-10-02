import { render, screen } from '@testing-library/react';
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
  useAuth: () => ({ access: { scope: 'internal', displayName: 'Test Staff' } }),
}));

describe('OverviewPage', () => {
  it('leads with the north star and never shows product intelligence', () => {
    render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    const strip = screen.getByTestId('kpi-strip');
    expect(strip.textContent).toContain('Hours filmed per paying seat');
    expect(strip.textContent).toContain('2.00');
    expect(strip.textContent).toContain('wk of Sep 21');
    expect(screen.getByText('Health signals')).toBeInTheDocument();
    expect(screen.getByText('Sources and definitions')).toBeInTheDocument();
    expect(screen.getAllByTestId('not-tracked').length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/product intelligence/i);
    expect(document.body.textContent).not.toMatch(/10% annual/i);
  });
});
