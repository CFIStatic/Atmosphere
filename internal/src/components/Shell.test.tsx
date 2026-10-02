import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ scope: 'internal' as 'internal' | 'investor' }));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u', email: 'staff@example.test', createdAt: '' },
    access: { scope: auth.scope, displayName: 'Test Staff' },
    logout: vi.fn(),
  }),
}));

import { Shell } from './Shell';

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/overview']}>
      <Shell />
    </MemoryRouter>,
  );
}

describe('Shell', () => {
  it('brands the site Atmosphere Analytics with grouped navigation', () => {
    auth.scope = 'internal';
    renderShell();
    expect(screen.getByText('Analytics')).toBeInTheDocument();
    for (const group of ['Growth & revenue', 'Capture pipeline', 'AI & Ask', 'Contacts & campaigns', 'System & access']) {
      expect(screen.getByText(group)).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: 'Contacts' })).toBeInTheDocument();
  });

  it('hides staff-only pages from investors', () => {
    auth.scope = 'investor';
    renderShell();
    expect(screen.queryByRole('link', { name: 'Contacts' })).toBeNull();
    expect(screen.queryByText('Contacts & campaigns')).toBeNull();
    expect(screen.getByRole('link', { name: 'Overview' })).toBeInTheDocument();
  });
});
