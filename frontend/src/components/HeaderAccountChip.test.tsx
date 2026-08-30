import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setPreference } from '../lib/preferences';
import { applyResolvedTheme } from '../lib/theme';
import { HeaderAccountChip } from './HeaderAccountChip';

const authState = vi.hoisted(() => ({
  user: {
    id: 'user-1',
    email: 'jack@jettx.ai',
    createdAt: '2026-01-01T00:00:00Z',
    lastSignInAt: '2026-08-22T00:00:00Z',
    emailConfirmed: true,
    metadata: {},
  },
  profile: {
    id: 'user-1',
    email: 'jack@jettx.ai',
    fullName: 'Jack Cyganiak',
    avatarUrl: null as string | null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-08-22T00:00:00Z',
  },
  membership: { role: 'global_admin', org: { id: 'org-1', name: 'Jettx LLC', joinCode: 'ABC123' } },
  logout: vi.fn(),
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => authState,
}));

function renderChip() {
  return render(
    <MemoryRouter>
      <HeaderAccountChip />
    </MemoryRouter>,
  );
}

describe('HeaderAccountChip', () => {
  beforeEach(() => {
    authState.logout.mockReset();
    authState.profile.fullName = 'Jack Cyganiak';
    authState.profile.avatarUrl = null;
    authState.membership.org.name = 'Jettx LLC';
    setPreference('theme', 'dark');
    applyResolvedTheme('dark');
  });

  it('shows the signed-in name, org, and avatar on the chip', () => {
    renderChip();
    expect(screen.getByRole('button', { name: 'Account menu' })).toHaveTextContent('Jack Cyganiak');
    expect(screen.getByRole('button', { name: 'Account menu' })).toHaveTextContent('Jettx LLC');
    expect(screen.getByText('JC')).toBeInTheDocument();
  });

  it('shows the saved photo on the chip instead of initials', () => {
    authState.profile.avatarUrl = 'https://img.example/jack-icon.png';
    renderChip();
    expect(screen.queryByText('JC')).toBeNull();
    expect(document.querySelector('img')).toHaveAttribute('src', 'https://img.example/jack-icon.png');
  });

  it('puts appearance, Settings, and sign-out in the account menu', async () => {
    const user = userEvent.setup();
    renderChip();

    expect(screen.queryByRole('menu', { name: 'Account' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Account menu' }));

    const menu = screen.getByRole('menu', { name: 'Account' });
    expect(menu).toHaveTextContent('Appearance: Dark');
    expect(menu).toHaveTextContent('Settings');
    expect(menu).toHaveTextContent('Sign out');
    expect(screen.getByRole('menuitem', { name: 'Switch to light mode' })).toBeInTheDocument();
  });

  it('cycles the document palette from the account menu', async () => {
    const user = userEvent.setup();
    renderChip();
    await user.click(screen.getByRole('button', { name: 'Account menu' }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    await user.click(screen.getByRole('menuitem', { name: 'Switch to light mode' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(screen.getByRole('menu', { name: 'Account' })).toHaveTextContent('Appearance: Light');
  });

  it('opens Settings from the account menu', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/intake']}>
        <Routes>
          <Route path="/intake" element={<HeaderAccountChip />} />
          <Route path="/settings" element={<p>Settings page</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Settings' }));
    expect(screen.getByText('Settings page')).toBeInTheDocument();
  });
});
