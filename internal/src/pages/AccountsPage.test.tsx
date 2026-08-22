import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AccountsPage } from './AccountsPage';
import { demoOverview } from '../lib/demo';

vi.mock('../hooks/useOverview', () => ({
  useOverview: () => ({
    data: demoOverview,
    error: null,
    loading: false,
    reload: vi.fn(),
    range: { from: new Date(), to: new Date(), months: 12 },
  }),
}));

describe('AccountsPage', () => {
  it('lists named organizations from the backend payload', () => {
    render(
      <MemoryRouter>
        <AccountsPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Accounts' })).toBeInTheDocument();
    expect(screen.getByText('Harbor Mitigation Co')).toBeInTheDocument();
    expect(screen.getByText('Northwind Restoration')).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
  });
});
