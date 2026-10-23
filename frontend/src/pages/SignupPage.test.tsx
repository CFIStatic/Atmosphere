import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
  getSelfServeBilling: vi.fn().mockResolvedValue({ annualAvailable: false, plans: [] }),
  startOnboardingCheckout: vi.fn(),
  updateProfile: vi.fn(),
  createOrg: vi.fn(),
  joinOrg: vi.fn(),
  orgInvites: vi.fn().mockResolvedValue({ invites: [] }),
  createOrgInvite: vi.fn(),
  getBillingWorkspace: vi.fn().mockResolvedValue({}),
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
    apiMocks.getSelfServeBilling.mockReset().mockResolvedValue({ annualAvailable: false, plans: [] });
    apiMocks.updateProfile.mockReset().mockResolvedValue({});
    apiMocks.createOrg.mockReset().mockResolvedValue({});
    apiMocks.joinOrg.mockReset();
    apiMocks.orgInvites.mockReset().mockResolvedValue({ invites: [] });
    apiMocks.createOrgInvite.mockReset().mockResolvedValue({ emailed: true });
    apiMocks.getBillingWorkspace.mockReset().mockResolvedValue({});
    window.innerWidth = 1280;
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
    expect(screen.getByLabelText(/I agree to the Terms of Service, including voiceprint consent/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute(
      'href',
      'https://atmosphereteam.com/terms',
    );
    expect(screen.getByRole('heading', { name: 'Account & workspace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Plan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite team' })).toBeInTheDocument();
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
    await user.click(screen.getByLabelText(/I agree to the Terms of Service, including voiceprint consent/i));
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  it('switches the right-hand card when a left-rail step is clicked', async () => {
    const user = userEvent.setup();
    renderSignup();

    // Invite team opens only after payment.
    await user.click(screen.getByRole('button', { name: 'Invite team' }));
    expect(screen.getByRole('heading', { name: 'Account & workspace' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Plan' }));
    expect(screen.getByRole('heading', { name: 'Set up billing' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Starter/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Work Verification/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Scale/i })).toBeInTheDocument();
    expect(screen.getAllByText('Per Month')).toHaveLength(3);
    expect(screen.getAllByText(/the Global Admin \(the account owner\) does not use a seat/)).toHaveLength(1);
    expect(screen.getAllByText(/\$125\/mo/)).toHaveLength(1);
    expect(screen.getByText(/Each plan includes an AI usage allowance/)).toBeInTheDocument();
    expect(screen.queryByText(/30-day notice/)).toBeNull();
    expect(screen.queryByLabelText(/I agree to the Terms of Service, including voiceprint consent/i)).toBeNull();
    expect(screen.queryByLabelText('Company name')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Account' }));
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
    await user.click(screen.getByLabelText(/I agree to the Terms of Service, including voiceprint consent/i));
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

  it('sends a new unpaid workspace straight from Account to plan and invites, no first job needed', async () => {
    const user = userEvent.setup();
    localStorage.clear();
    authState.user = {
      id: 'user-1',
      email: 'owner@acme.com',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastSignInAt: '2026-08-20T00:00:00.000Z',
      emailConfirmed: true,
      metadata: {},
    };
    authState.membership = null;
    authState.refreshMembership
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ org: { id: 'org-1', name: 'Acme Restoration' } });
    apiMocks.getBillingOnboarding.mockResolvedValue({ required: true, complete: false });
    vi.mocked(api.createOrg).mockResolvedValue({
      org: { id: 'org-1', name: 'Acme Restoration', joinCode: '8F3A9C2B' },
    });

    render(
      <MemoryRouter initialEntries={['/signup']}>
        <Routes>
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/welcome" element={<h1>Welcome page</h1>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText('Company name'), { target: { value: 'Acme Restoration' } });
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(api.createOrg).toHaveBeenCalled());
    expect(await screen.findByRole('heading', { name: 'Set up billing' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Welcome page' })).toBeNull();
    expect(screen.queryByText(/first job/i)).toBeNull();
    expect(screen.queryByText(/first evidence/i)).toBeNull();
  });

  it('does not ask for company type when joining an existing workspace', async () => {
    renderSignup('/signup?step=2&intent=join');

    expect(screen.queryByLabelText('Join code')).toBeNull();
    expect(screen.getByText(/Use the invited email/i)).toBeInTheDocument();
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
    authState.refreshMembership.mockResolvedValueOnce(null).mockImplementation(async () => {
      authState.membership = { role: 'global_admin', org: { id: 'org-1', name: 'Meridian Services' } };
      return authState.membership;
    });
    apiMocks.createOrg.mockResolvedValue({
      org: { id: 'org-1', name: 'Meridian Services', joinCode: '8F3A9C2B' },
    });

    renderSignup('/signup?step=2');
    fireEvent.change(screen.getByLabelText('Company name'), {
      target: { value: 'Meridian Services' },
    });
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // Comped / exempt on a computer: the optional invite screen, then the Dashboard.
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Invite your team' })).toBeInTheDocument());
    expect(queueRedirect).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: 'Skip for now' }));
    await waitFor(() => {
      expect(queueRedirect).toHaveBeenCalled();
    });
    expect(apiMocks.createOrg).toHaveBeenCalled();
    const destination = String(queueRedirect.mock.calls[0]?.[0] ?? '');
    expect(destination).toBe('/verifier-library');
    expect(destination).not.toMatch(/[?&]tour=/);
  });

  it('sends a paid Stripe return to the Dashboard, not Start a job', async () => {
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
      expect(queueRedirect).toHaveBeenCalledWith('/verifier-library');
    });
  });

  it('sends a Stripe return that started from Start a job, or an old first-run job, to the Dashboard', async () => {
    localStorage.setItem('atmosphere.firstRun.org-1', JSON.stringify({ jobId: 'job-1', jobTitle: 'Smith', jobNumber: 1 }));
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

    renderSignup('/signup?step=2&checkout=success&next=%2Fintake');

    await waitFor(() => {
      expect(queueRedirect).toHaveBeenCalledWith('/verifier-library');
    });
    localStorage.clear();
  });

  it('keeps a specific deep link on a paid Stripe return', async () => {
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

    renderSignup('/signup?step=2&checkout=success&next=%2Fsettings%3Fsection%3Dteam');

    await waitFor(() => {
      expect(queueRedirect).toHaveBeenCalledWith('/settings?section=team');
    });
  });

  const signedInAdmin = () => {
    authState.user = {
      id: 'user-1',
      email: 'owner@example.com',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastSignInAt: '2026-08-20T00:00:00.000Z',
      emailConfirmed: true,
      metadata: {},
    };
    authState.membership = { role: 'global_admin', org: { id: 'org-1', name: 'Example Co' } };
    apiMocks.getBillingOnboarding.mockResolvedValue({ required: true, complete: true });
  };

  it('after a paid Stripe return on a computer, shows the optional company invite step; Skip goes to the Dashboard', async () => {
    const user = userEvent.setup();
    signedInAdmin();
    renderSignup('/signup?step=2&checkout=success&next=%2Fverifier-library');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Invite your team' })).toBeInTheDocument());
    expect(screen.getByTestId('setup-invite-panel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite team' })).toHaveAttribute('aria-current', 'step');
    expect(screen.queryByRole('button', { name: 'Continue to dashboard' })).toBeNull();
    expect(queueRedirect).not.toHaveBeenCalled();

    await user.click(await screen.findByRole('button', { name: 'Skip for now' }));
    expect(queueRedirect).toHaveBeenCalledWith('/verifier-library');
    expect(apiMocks.createOrgInvite).not.toHaveBeenCalled();
  });

  it('sends a company-level invite with no job, then Continue to dashboard', async () => {
    const user = userEvent.setup();
    signedInAdmin();
    renderSignup('/signup?step=invite');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Invite your team' })).toBeInTheDocument());
    await user.type(screen.getByLabelText('Email'), 'crew@example.com');
    await user.click(screen.getByRole('button', { name: 'Invite' }));

    await waitFor(() =>
      expect(apiMocks.createOrgInvite).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'crew@example.com', role: 'employee' }),
      ),
    );
    await user.click(await screen.findByRole('button', { name: 'Continue to dashboard' }));
    expect(queueRedirect).toHaveBeenCalledWith('/verifier-library');
  });

  it('keeps a deep link through the invite step', async () => {
    const user = userEvent.setup();
    signedInAdmin();
    renderSignup('/signup?step=2&checkout=success&next=%2Fsettings%3Fsection%3Dteam');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Invite your team' })).toBeInTheDocument());
    await user.click(await screen.findByRole('button', { name: 'Skip for now' }));
    expect(queueRedirect).toHaveBeenCalledWith('/settings?section=team');
  });

  it('does not open the invite step before the plan is paid', async () => {
    signedInAdmin();
    apiMocks.getBillingOnboarding.mockResolvedValue({ required: true, complete: false });
    renderSignup('/signup?step=invite');

    expect(await screen.findByRole('heading', { name: 'Set up billing' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Invite your team' })).toBeNull();
  });

  it('phones skip the invite step after payment', async () => {
    window.innerWidth = 390;
    signedInAdmin();
    renderSignup('/signup?step=2&checkout=success&next=%2Fverifier-library');

    await waitFor(() => expect(queueRedirect).toHaveBeenCalledWith('/verifier-library'));
    expect(screen.queryByRole('heading', { name: 'Invite your team' })).toBeNull();
  });

  it.each([
    ['/signup?step=2&intent=join'],
    ['/signup?step=2&intent=join&checkout=success'],
    ['/signup?step=2&checkout=success'],
  ])('an invited teammate who already joined never sees a plan, price or checkout (%s)', async (entry) => {
    authState.user = {
      id: 'user-9',
      email: 'crew@example.com',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastSignInAt: '2026-08-20T00:00:00.000Z',
      emailConfirmed: true,
      metadata: {},
    };
    authState.membership = { org: { id: 'org-1', name: 'Acme' } };
    // Not the payer: billing is the owner's company account.
    apiMocks.getBillingOnboarding.mockResolvedValue({ required: false, complete: false });
    renderSignup(entry);
    await waitFor(() => expect(apiMocks.getBillingOnboarding).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Set up billing' })).toBeNull());
    expect(screen.queryByText(/Continue to Stripe/i)).toBeNull();
    expect(screen.queryByRole('radio', { name: /Starter|Work Verification/i })).toBeNull();
    expect(screen.queryByText(/free trial/i)).toBeNull();
    expect(apiMocks.startOnboardingCheckout).not.toHaveBeenCalled();
  });

  it('a join-by-invite with no membership yet shows no plan picker', () => {
    renderSignup('/signup?step=2&intent=join');
    expect(screen.queryByText(/Set up billing|Joiners skip|pays the bill/i)).toBeNull();
    expect(screen.queryByRole('radio', { name: /Starter|Work Verification/i })).toBeNull();
    expect(screen.queryByText(/Continue to Stripe/i)).toBeNull();
  });

  it('never shows plan or billing UI on a homeowner invitee signup', () => {
    renderSignup('/signup?intent=homeowner&step=2&checkout=success');
    expect(screen.getByRole('heading', { level: 2, name: 'Save this job' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Set up billing' })).toBeNull();
    expect(screen.queryByRole('radio', { name: /Starter/i })).toBeNull();
    expect(screen.queryByRole('radio', { name: /Work Verification/i })).toBeNull();
    expect(screen.queryByText(/Continue to Stripe/i)).toBeNull();
    expect(screen.getAllByText(/free for homeowners/i).length).toBeGreaterThan(0);
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
    await user.click(screen.getByLabelText(/I agree to the Terms of Service, including voiceprint consent/i));
    await user.click(
      screen
        .getAllByRole('button', { name: 'Save this job' })
        .find((el) => (el as HTMLButtonElement).type === 'submit')!,
    );

    await waitFor(() => {
      expect(queueRedirect).toHaveBeenCalledWith('/verifier-library');
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
    await user.click(screen.getByLabelText(/I agree to the Terms of Service, including voiceprint consent/i));
    await user.click(
      screen
        .getAllByRole('button', { name: 'Save this job' })
        .find((el) => (el as HTMLButtonElement).type === 'submit')!,
    );

    await waitFor(() => {
      expect(queueRedirect).toHaveBeenCalledWith('/progress/tok123');
    });
  });

  it('creates a capture-invite account without a join code or workspace', async () => {
    renderSignup('/signup?intent=capture&email=jack%40roitechai.com&token=tok123');
    expect(screen.getByRole('heading', { level: 2, name: 'Create your account' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Join code')).toBeNull();
    expect(screen.queryByLabelText('Company name')).toBeNull();
    expect(screen.queryByText(/Global Admin/i)).toBeNull();
    expect(screen.queryByText(/ACCOUNT & JOIN CODE/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument();
    expect(apiMocks.createOrg).not.toHaveBeenCalled();
    expect(apiMocks.joinOrg).not.toHaveBeenCalled();
  });
});
