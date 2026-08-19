import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    membership: null,
    signup: vi.fn(),
    refreshMembership: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock('../lib/api', () => ({
  api: {
    getBillingOnboarding: () => Promise.resolve({ required: false, complete: true }),
    startOnboardingCheckout: vi.fn(),
    updateProfile: vi.fn(),
    createOrg: vi.fn(),
    joinOrg: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status = 400;
    code = 'signup_failed';
  },
}));

vi.mock('../hooks/usePendingAuthRedirect', () => ({
  usePendingAuthRedirect: () => vi.fn(),
}));

import { SignupPage } from './SignupPage';

describe('SignupPage', () => {
  beforeEach(() => {
    document.title = 'Atmosphere';
  });

  it('starts on account details only — workspace and join code wait for step 2', () => {
    render(
      <MemoryRouter>
        <SignupPage />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText('Your name')).toBeInTheDocument();
    expect(screen.getByLabelText('Work email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue to workspace' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Company name')).toBeNull();
    expect(screen.queryByLabelText('Join code')).toBeNull();
    expect(screen.getByText('Your workspace')).toBeInTheDocument();
    expect(screen.getByText('Set up billing')).toBeInTheDocument();
    expect(screen.queryByText('Invite teammates')).toBeNull();
    expect(screen.queryByText('You are in')).toBeNull();
  });

  it('switches the right-hand card when a left-rail step is clicked', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SignupPage />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Your workspace' }));
    expect(screen.getByRole('heading', { name: 'Your workspace' })).toBeInTheDocument();
    expect(screen.getByLabelText('Company name')).toBeInTheDocument();
    expect(screen.queryByLabelText('Your name')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Set up billing' }));
    expect(screen.getByRole('heading', { name: 'Set up billing' })).toBeInTheDocument();
    expect(screen.getByText(/\/ month/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Company name')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Create your account' }));
    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeInTheDocument();
    expect(screen.getByLabelText('Your name')).toBeInTheDocument();
  });
});
