import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
    expect(screen.getByText('You are in')).toBeInTheDocument();
    expect(screen.getByText('Set up billing')).toBeInTheDocument();
  });
});
