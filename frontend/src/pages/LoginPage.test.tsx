import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    login: vi.fn(),
    unlockWithPin: vi.fn(),
  }),
}));

vi.mock('../lib/api', () => ({
  api: {
    pinStatus: () => Promise.resolve({ enrolled: false }),
  },
  ApiError: class ApiError extends Error {
    status = 401;
    code = 'invalid_credentials';
  },
}));

vi.mock('../hooks/usePendingAuthRedirect', () => ({
  usePendingAuthRedirect: () => vi.fn(),
}));

import { LoginPage } from './LoginPage';

describe('LoginPage', () => {
  beforeEach(() => {
    document.title = 'Atmosphere';
  });

  it('offers a single create-account link instead of org vs office cards', () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/signup/),
    );
    expect(screen.queryByText('Need an account?')).toBeNull();
    expect(screen.queryByText('Link to office account')).toBeNull();
    expect(screen.queryByText(/start a new organization/i)).toBeNull();
  });
});
