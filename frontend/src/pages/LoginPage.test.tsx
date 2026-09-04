import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pinStatus = vi.hoisted(() =>
  vi.fn(async () => ({ enrolled: false as boolean, lockedUntil: null as string | null })),
);

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
    pinStatus: () => pinStatus(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, message: string, code = 'error') {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

vi.mock('../hooks/usePendingAuthRedirect', () => ({
  usePendingAuthRedirect: () => queueRedirect,
}));

import { LoginPage } from './LoginPage';

function renderLogin(initialEntry = '/login') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/verifier-library" element={<div>Workspace home</div>} />
        <Route path="/signup" element={<div>Signup</div>} />
      </Routes>
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
    pinStatus.mockReset().mockResolvedValue({ enrolled: false, lockedUntil: null });
    delete document.documentElement.dataset.fieldEmbed;
  });

  it('places a large Atmosphere lockup in the top-left corner', () => {
    const { container } = renderLogin();
    const home = screen.getByRole('link', { name: 'Atmosphere home' });
    const svg = home.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('34');
    expect(svg?.getAttribute('height')).toBe('34');
    expect(screen.getByText('Atmosphere').className).toContain('text-[23px]');
    expect(container.querySelector('header')?.className).toContain('py-8');
    expect(container.querySelector('[data-atmosphere-lockup]')?.className).toContain('text-ink-900');
    expect(screen.getByRole('button', { name: /Switch to (light|dark) mode/ })).toBeInTheDocument();
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

  it('sends a signed-in customer straight to their workspace', () => {
    authState.user = signedInUser;
    authState.membership = { org: { id: 'org-1', name: 'Jettx LLC' } };

    renderLogin();

    expect(screen.getByText('Workspace home')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Welcome back' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue to workspace' })).toBeNull();
  });

  it('sends a signed-in customer without a workspace to finish setup', () => {
    authState.user = signedInUser;
    authState.membership = null;

    renderLogin();

    expect(screen.getByText('Signup')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Welcome back' })).toBeNull();
  });

  it('honors ?next= when a leftover session is already signed in', () => {
    authState.user = signedInUser;
    authState.membership = { org: { id: 'org-1', name: 'Jettx LLC' } };

    renderLogin('/login?next=%2Fverifier-library');

    expect(screen.getByText('Workspace home')).toBeInTheDocument();
  });

  it('keeps the sign-in form when the visitor asks to switch accounts', () => {
    authState.user = signedInUser;
    authState.membership = { org: { id: 'org-1', name: 'Jettx LLC' } };

    renderLogin('/login?switch=1');

    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByText('jack@jettx.ai')).toBeInTheDocument();
    expect(screen.getByText('Jettx LLC')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue to workspace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('lets a signed-in visitor continue to their workspace from the switch-account form', async () => {
    const user = userEvent.setup();
    authState.user = signedInUser;
    authState.membership = { org: { id: 'org-1', name: 'Jettx LLC' } };

    renderLogin('/login?switch=1');
    await user.click(screen.getByRole('button', { name: 'Continue to workspace' }));

    expect(queueRedirect).toHaveBeenCalledWith('/verifier-library');
  });

  it('does not show a second password form inside the Field Capture frame', () => {
    document.documentElement.dataset.fieldEmbed = '1';
    renderLogin('/login?embed=field&next=%2Fverifier-library%3Fembed%3Dfield');
    expect(screen.getByText('Opening your workspace…')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Welcome back' })).toBeNull();
    expect(screen.queryByLabelText('Email')).toBeNull();
  });

  it('skips the device PIN inside the Field Capture frame — one login is enough', async () => {
    pinStatus.mockResolvedValue({ enrolled: true, lockedUntil: null });
    document.documentElement.dataset.fieldEmbed = '1';

    renderLogin('/login?embed=field&next=%2Fverifier-library%3Fembed%3Dfield');

    expect(screen.getByText('Opening your workspace…')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Enter your PIN' })).toBeNull();
    await Promise.resolve();
    expect(pinStatus).not.toHaveBeenCalled();
  });

  it('signs the current session out before signing in as a different account', async () => {
    const user = userEvent.setup();
    authState.user = signedInUser;
    authState.membership = { org: { id: 'org-1', name: 'Jettx LLC' } };
    authState.login.mockResolvedValue({ org: { id: 'org-2', name: 'Acme' } });

    renderLogin('/login?switch=1');
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

  it('shows a readable error instead of the raw word Forbidden', async () => {
    const user = userEvent.setup();
    const { ApiError } = await import('../lib/api');
    authState.login.mockRejectedValueOnce(
      new ApiError(403, 'Sign-in was blocked. Reload this page and try again.', 'blocked'),
    );

    renderLogin();
    await user.type(screen.getByLabelText('Email'), 'jack@jettx.ai');
    await user.type(screen.getByLabelText('Password'), 'password1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Sign-in was blocked. Reload this page and try again.',
    );
    expect(screen.queryByText('Forbidden')).toBeNull();
  });
});
