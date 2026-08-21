import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    access: null,
    loading: false,
    login: vi.fn(),
    enterDemo: vi.fn(),
  }),
}));

describe('LoginPage', () => {
  it('is a staff sign-in, not a public signup', () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Internal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview with demo data' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /create/i })).toBeNull();
  });

  it('lets staff preview without a live backend', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Preview with demo data' }));
    expect(sessionStorage.getItem('atmosphere.internal.demo')).toBe('1');
  });
});
