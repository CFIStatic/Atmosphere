import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  signup: vi.fn(),
  refreshMembership: vi.fn(),
  logout: vi.fn(),
}));

const queueRedirect = vi.hoisted(() => vi.fn());

const apiMocks = vi.hoisted(() => ({
  getBillingOnboarding: vi.fn().mockResolvedValue({ required: false, complete: true }),
  startOnboardingCheckout: vi.fn(),
  updateProfile: vi.fn(),
  createOrg: vi.fn(),
  joinOrg: vi.fn(),
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => authState,
}));

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return {
    ...actual,
    api: apiMocks,
    ApiError: class ApiError extends Error {
      status = 400;
      code = 'signup_failed';
    },
  };
});

vi.mock('../hooks/usePendingAuthRedirect', () => ({
  usePendingAuthRedirect: () => queueRedirect,
}));

import { api } from '../lib/api';
import { SignupPage } from './SignupPage';

function renderSignup(initialEntry = '/signup') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <SignupPage />
    </MemoryRouter>,
  );
}

describe('SignupPage', () => {
  beforeEach(() => {
    document.title = 'Atmosphere';
    authState.user = null;
    authState.loading = false;
    authState.membership = null;
    authState.signup.mockReset();
    authState.refreshMembership.mockReset();
    authState.logout.mockReset().mockResolvedValue(undefined);
    queueRedirect.mockReset();
    apiMocks.getBillingOnboarding.mockReset().mockResolvedValue({ required: false, complete: true });
    apiMocks.updateProfile.mockReset().mockResolvedValue({});
    apiMocks.createOrg.mockReset().mockResolvedValue({});
    apiMocks.joinOrg.mockReset();
  });

  it('puts account and company name on the first step — no company type', () => {
    renderSignup();

    expect(screen.getByLabelText('Your name')).toBeInTheDocument();
    expect(screen.getByLabelText('Work email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Company name')).toBeInTheDocument();
    expect(screen.queryByLabelText('Company type')).toBeNull();
    expect(screen.queryByLabelText('Join code')).toBeNull();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Account & workspace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Account & workspace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set up billing' })).toBeInTheDocument();
    expect(screen.queryByText('Your workspace')).toBeNull();
    expect(screen.queryByText('Create your account')).toBeNull();
    expect(screen.queryByText('Invite teammates')).toBeNull();
    expect(screen.queryByText('You are in')).toBeNull();
  });

  it('switches the right-hand card when a left-rail step is clicked', async () => {
    const user = userEvent.setup();
    renderSignup();

    await user.click(screen.getByRole('button', { name: 'Set up billing' }));
    expect(screen.getByRole('heading', { name: 'Set up billing' })).toBeInTheDocument();
    expect(screen.getByText(/\/ month/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Company name')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Account & workspace' }));
    expect(screen.getByRole('heading', { name: 'Account & workspace' })).toBeInTheDocument();
    expect(screen.getByLabelText('Your name')).toBeInTheDocument();
    expect(screen.getByLabelText('Company name')).toBeInTheDocument();
  });

  it('keeps a signed-in customer on company setup instead of sending them to the dashboard', () => {
    authState.user = {
      id: 'user-1',
      email: 'jane@acme.com',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastSignInAt: '2026-08-20T00:00:00.000Z',
      emailConfirmed: true,
      metadata: {},
    };
    authState.membership = { org: { id: 'org-1', name: 'Acme' } };

    renderSignup();

    expect(screen.getByRole('heading', { name: 'Account & workspace' })).toBeInTheDocument();
    expect(screen.getByLabelText('Your name')).toBeInTheDocument();
    expect(screen.getByLabelText('Work email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Company name')).toBeInTheDocument();
    expect(screen.getByText('jane@acme.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Account ready' })).toBeNull();
  });

  it('signs the current session out before creating a different account', async () => {
    const user = userEvent.setup();
    authState.user = {
      id: 'user-1',
      email: 'jane@acme.com',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastSignInAt: '2026-08-20T00:00:00.000Z',
      emailConfirmed: true,
      metadata: {},
    };
    authState.membership = { org: { id: 'org-1', name: 'Acme' } };
    authState.signup.mockResolvedValue({
      needsEmailConfirmation: false,
      membership: null,
      user: {
        id: 'user-2',
        email: 'new@acme.com',
        emailConfirmed: true,
      },
    });
    authState.refreshMembership.mockResolvedValue(null);
    apiMocks.createOrg.mockResolvedValue({
      org: { id: 'org-2', name: 'New Person', joinCode: 'ABCD1234' },
    });

    renderSignup();
    await user.type(screen.getByLabelText('Your name'), 'New Person');
    await user.type(screen.getByLabelText('Work email'), 'new@acme.com');
    await user.type(screen.getByLabelText('Password'), 'password1');
    fireEvent.change(screen.getByLabelText('Company name'), {
      target: { value: 'New Person Co' },
    });
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(authState.signup).toHaveBeenCalledWith('new@acme.com', 'password1');
    });
    expect(authState.logout).toHaveBeenCalledTimes(1);
    expect(authState.logout.mock.invocationCallOrder[0]).toBeLessThan(
      authState.signup.mock.invocationCallOrder[0]!,
    );
  });

  it('creates a workspace from a company name without asking for company type', async () => {
    const user = userEvent.setup();
    authState.user = {
      id: 'user-1',
      email: 'owner@acme.com',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastSignInAt: '2026-08-20T00:00:00.000Z',
      emailConfirmed: true,
      metadata: {},
    };
    authState.membership = null;
    authState.refreshMembership.mockResolvedValue(null);
    vi.mocked(api.createOrg).mockResolvedValue({
      org: { id: 'org-1', name: 'Acme Restoration', joinCode: '8F3A9C2B' },
    });

    renderSignup('/signup?step=2');

    expect(screen.queryByLabelText('Company type')).toBeNull();
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(screen.getByLabelText('Company name')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Company name'), {
      target: { value: 'Acme Restoration' },
    });
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(api.createOrg).toHaveBeenCalledWith(
        'Acme Restoration',
        'global_admin',
        'construction',
        'other',
        ['field_work', 'exploring', 'billing'],
      );
    });
  });

  it('does not ask for company type when joining an existing workspace', async () => {
    renderSignup('/signup?step=2&intent=join');

    expect(screen.getByLabelText('Join code')).toBeInTheDocument();
    expect(screen.getByLabelText('Your name')).toBeInTheDocument();
    expect(screen.queryByLabelText('Company type')).toBeNull();
    expect(screen.queryByLabelText('Company name')).toBeNull();
  });

  it('enters the app after workspace setup without starting a product tour', async () => {
    const user = userEvent.setup();
    authState.user = {
      id: 'user-2',
      email: 'new@acme.com',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastSignInAt: '2026-08-22T00:00:00.000Z',
      emailConfirmed: true,
      metadata: {},
    };
    authState.membership = null;
    authState.refreshMembership
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ org: { id: 'org-1', name: 'Meridian Services' } });
    apiMocks.createOrg.mockResolvedValue({
      org: { id: 'org-1', name: 'Meridian Services', joinCode: '8F3A9C2B' },
    });

    renderSignup('/signup?step=2');
    fireEvent.change(screen.getByLabelText('Company name'), {
      target: { value: 'Meridian Services' },
    });
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(queueRedirect).toHaveBeenCalled();
    });
    expect(apiMocks.createOrg).toHaveBeenCalled();
    const destination = String(queueRedirect.mock.calls[0]?.[0] ?? '');
    expect(destination).toMatch(/^\//);
    expect(destination).not.toMatch(/[?&]tour=/);
  });
});
