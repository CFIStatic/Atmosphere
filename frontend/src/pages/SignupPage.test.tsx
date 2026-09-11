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
    apiMocks.getBillingOnboarding
      .mockReset()
      .mockResolvedValue({ required: false, complete: true });
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
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(screen.getByLabelText(/I acknowledge and agree to the/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute(
      'href',
      'https://atmosphereteam.com/terms',
    );
    expect(screen.getByRole('heading', { name: 'Account & workspace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Account & workspace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set up billing' })).toBeInTheDocument();
    expect(screen.queryByText('Your workspace')).toBeNull();
    expect(screen.queryByText('Create your account')).toBeNull();
    expect(screen.queryByText('Invite teammates')).toBeNull();
    expect(screen.queryByText('You are in')).toBeNull();
  });

  it('does not enable Continue until the Terms checkbox is checked', async () => {
    const user = userEvent.setup();
    renderSignup();

    await user.type(screen.getByLabelText('Your name'), 'New Person');
    await user.type(screen.getByLabelText('Work email'), 'new@acme.com');
    await user.type(screen.getByLabelText('Password'), 'password1');
    fireEvent.change(screen.getByLabelText('Company name'), {
      target: { value: 'New Person Co' },
    });

    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await user.click(screen.getByLabelText(/I acknowledge and agree to the/i));
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  it('switches the right-hand card when a left-rail step is clicked', async () => {
    const user = userEvent.setup();
    renderSignup();

    await user.click(screen.getByRole('button', { name: 'Set up billing' }));
    expect(screen.getByRole('heading', { name: 'Set up billing' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Starter/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Work Verification/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Scale/i })).toBeInTheDocument();
    expect(screen.getAllByText('/ month')).toHaveLength(3);
    expect(screen.queryByLabelText(/I acknowledge and agree to the/i)).toBeNull();
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
    expect(screen.queryByText(/You're signed in as/i)).toBeNull();
    expect(screen.queryByText(/Creating a new account will switch/i)).toBeNull();
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
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await user.click(screen.getByLabelText(/I acknowledge and agree to the/i));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(authState.signup).toHaveBeenCalledWith('new@acme.com', 'password1', '2026-09-10');
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

  it('keeps your name and company name independent while typing', async () => {
    const user = userEvent.setup();
    renderSignup();

    await user.type(screen.getByLabelText('Your name'), 'Jack Cyganiak');
    expect(screen.getByLabelText('Company name')).toHaveValue('');

    await user.type(screen.getByLabelText('Work email'), 'jack@meridian.example');
    expect(screen.getByLabelText('Company name')).toHaveValue('');

    await user.type(screen.getByLabelText('Company name'), 'Meridian Services');
    expect(screen.getByLabelText('Your name')).toHaveValue('Jack Cyganiak');
    expect(screen.getByLabelText('Company name')).toHaveValue('Meridian Services');
  });

  it('opens billing — not the account form — after a Stripe checkout return', () => {
    renderSignup('/signup?step=2&checkout=success');

    expect(screen.getByRole('heading', { name: 'Set up billing' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Your name')).toBeNull();
    expect(screen.queryByLabelText('Company name')).toBeNull();
  });

  it('auto-enters after a paid Stripe return once billing is complete', async () => {
    authState.user = {
      id: 'user-1',
      email: 'jane@acme.com',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastSignInAt: '2026-08-20T00:00:00.000Z',
      emailConfirmed: true,
      metadata: {},
    };
    authState.membership = { org: { id: 'org-1', name: 'Acme' } };
    apiMocks.getBillingOnboarding.mockResolvedValue({ required: true, complete: true });

    renderSignup('/signup?step=2&checkout=success');

    await waitFor(() => {
      expect(queueRedirect).toHaveBeenCalled();
    });
    expect(screen.queryByLabelText('Your name')).toBeNull();
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
    expect(destination).toBe('/intake');
    expect(destination).not.toMatch(/[?&]tour=/);
  });

  it('sends a paid Stripe return to Start a job, not the empty dashboard', async () => {
    authState.user = {
      id: 'user-1',
      email: 'jane@acme.com',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastSignInAt: '2026-08-20T00:00:00.000Z',
      emailConfirmed: true,
      metadata: {},
    };
    authState.membership = { org: { id: 'org-1', name: 'Acme' } };
    apiMocks.getBillingOnboarding.mockResolvedValue({ required: true, complete: true });

    renderSignup('/signup?step=2&checkout=success&next=%2Fverifier-library');

    await waitFor(() => {
      expect(queueRedirect).toHaveBeenCalledWith('/intake');
    });
  });

  it('sends a homeowner save-job account to the hub when there is no job link', async () => {
    const user = userEvent.setup();
    authState.signup.mockResolvedValue({
      needsEmailConfirmation: false,
      membership: null,
      user: { id: 'user-h', email: 'home@example.com', emailConfirmed: true },
    });
    authState.refreshMembership.mockResolvedValue(null);

    renderSignup('/signup?intent=homeowner');
    expect(screen.getByRole('heading', { level: 2, name: 'Save this job' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Company name')).toBeNull();

    await user.type(screen.getByLabelText('Email'), 'home@example.com');
    await user.type(screen.getByLabelText('Password'), 'password1');
    await user.click(screen.getByLabelText(/I acknowledge and agree to the/i));
    await user.click(
      screen
        .getAllByRole('button', { name: 'Save this job' })
        .find((el) => (el as HTMLButtonElement).type === 'submit')!,
    );

    await waitFor(() => {
      expect(queueRedirect).toHaveBeenCalledWith('/my-job-files');
    });
    expect(apiMocks.createOrg).not.toHaveBeenCalled();
  });

  it('keeps a progress deep link after homeowner signup', async () => {
    const user = userEvent.setup();
    authState.signup.mockResolvedValue({
      needsEmailConfirmation: false,
      membership: null,
      user: { id: 'user-h', email: 'home@example.com', emailConfirmed: true },
    });
    authState.refreshMembership.mockResolvedValue(null);

    renderSignup('/signup?intent=homeowner&next=%2Fprogress%2Ftok123');
    await user.type(screen.getByLabelText('Email'), 'home@example.com');
    await user.type(screen.getByLabelText('Password'), 'password1');
    await user.click(screen.getByLabelText(/I acknowledge and agree to the/i));
    await user.click(
      screen
        .getAllByRole('button', { name: 'Save this job' })
        .find((el) => (el as HTMLButtonElement).type === 'submit')!,
    );

    await waitFor(() => {
      expect(queueRedirect).toHaveBeenCalledWith('/progress/tok123');
    });
  });
});
