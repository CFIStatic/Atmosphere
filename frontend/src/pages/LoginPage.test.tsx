import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  user: null as {
    id: string;
    email: string | null;
    createdAt: string;
    lastSignInAt: string | null;
    emailConfirmed: boolean;
    metadata: Record<string, unknown>;
  } | null,
  loading: false,
  membership: null as { org: { id: string; name: string } | null } | null,
  membershipLoading: false,
  login: vi.fn(),
  unlockWithPin: vi.fn(),
  logout: vi.fn(),
}));

const queueRedirect = vi.hoisted(() => vi.fn());

vi.mock('../context/AuthContext', () => ({
  useAuth: () => authState,
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
  usePendingAuthRedirect: () => queueRedirect,
}));

import { LoginPage } from './LoginPage';

function renderLogin(initialEntry = '/login') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LoginPage />
    </MemoryRouter>,
  );
}

const signedInUser = {
  id: 'user-1',
  email: 'jack@jettx.ai',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastSignInAt: '2026-08-20T00:00:00.000Z',
  emailConfirmed: true,
  metadata: {},
};

describe('LoginPage', () => {
  beforeEach(() => {
    document.title = 'Atmosphere';
    authState.user = null;
    authState.loading = false;
    authState.membership = null;
    authState.membershipLoading = false;
    authState.login.mockReset();
    authState.unlockWithPin.mockReset();
    authState.logout.mockReset().mockResolvedValue(undefined);
    queueRedirect.mockReset();
  });

  it('offers a single create-account link instead of org vs office cards', () => {
    renderLogin();

    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/signup/),
    );
    expect(screen.queryByText('Need an account?')).toBeNull();
    expect(screen.queryByText('Link to office account')).toBeNull();
    expect(screen.queryByText(/start a new organization/i)).toBeNull();
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('keeps a signed-in customer on the sign-in form instead of sending them to the dashboard', () => {
    authState.user = signedInUser;
    authState.membership = { org: { id: 'org-1', name: 'Jettx LLC' } };

    renderLogin();

    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByText('jack@jettx.ai')).toBeInTheDocument();
    expect(screen.getByText('Jettx LLC')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue to workspace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('lets a signed-in visitor continue to their workspace without leaving the form first', async () => {
    const user = userEvent.setup();
    authState.user = signedInUser;
    authState.membership = { org: { id: 'org-1', name: 'Jettx LLC' } };

    renderLogin();
    await user.click(screen.getByRole('button', { name: 'Continue to workspace' }));

    expect(queueRedirect).toHaveBeenCalledWith('/field');
  });

  it('signs the current session out before signing in as a different account', async () => {
    const user = userEvent.setup();
    authState.user = signedInUser;
    authState.membership = { org: { id: 'org-1', name: 'Jettx LLC' } };
    authState.login.mockResolvedValue({ org: { id: 'org-2', name: 'Acme' } });

    renderLogin();
    await user.type(screen.getByLabelText('Email'), 'new@acme.com');
    await user.type(screen.getByLabelText('Password'), 'password1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(authState.login).toHaveBeenCalledWith('new@acme.com', 'password1');
    });
    expect(authState.logout).toHaveBeenCalledTimes(1);
    expect(authState.logout.mock.invocationCallOrder[0]).toBeLessThan(
      authState.login.mock.invocationCallOrder[0]!,
    );
  });
});
