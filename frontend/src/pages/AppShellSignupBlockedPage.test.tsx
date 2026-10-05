import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  user: null as { id: string } | null,
  logout: vi.fn(async () => {}),
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => authState,
}));

import { AppShellSignupBlockedPage } from './AppShellSignupBlockedPage';

describe('AppShellSignupBlockedPage', () => {
  it('links out to the website sign-up page with no price or purchase wording', () => {
    authState.user = null;
    render(
      <MemoryRouter>
        <AppShellSignupBlockedPage />
      </MemoryRouter>,
    );
    const out = screen.getByTestId('app-shell-signup-website-link');
    expect(out.getAttribute('href')).toBe('https://atmosphereteam.com/signup');
    expect(out.getAttribute('target')).toBe('_blank');
    const text = screen.getByTestId('app-shell-signup-blocked').textContent ?? '';
    expect(text).not.toMatch(/\$|price|buy|purchase|checkout|stripe|subscribe/i);
    expect(screen.getByRole('link', { name: 'Back to sign in' }).getAttribute('href')).toBe('/login');
  });

  it('lets a signed-in person without a company sign out', async () => {
    authState.user = { id: 'u1' };
    render(
      <MemoryRouter>
        <AppShellSignupBlockedPage />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(authState.logout).toHaveBeenCalled();
  });
});
