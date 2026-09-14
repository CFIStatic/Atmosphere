import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage';
import { rememberStaffEmail } from '../lib/rememberedEmail';

const startSignIn = vi.fn();
const login = vi.fn();

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    access: null,
    loading: false,
    startSignIn,
    login,
  }),
}));

describe('LoginPage', () => {
  beforeEach(() => {
    startSignIn.mockReset();
    login.mockReset();
    localStorage.clear();
  });

  it('shows invite-only Platform email + password sign-in', () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Internal' })).toBeInTheDocument();
    expect(screen.getByText('Atmosphere')).toBeInTheDocument();
    expect(document.querySelector('[data-atmosphere-lockup]')).not.toBeNull();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByText(/same email and password as your Atmosphere Platform account/i)).toBeInTheDocument();
    expect(screen.getByText(/Invite-only/i)).toBeInTheDocument();
    expect(screen.queryByText(/Microsoft Authenticator/i)).toBeNull();
    expect(screen.queryByLabelText('First name')).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Need access\? Request an invite/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /demo/i })).toBeNull();
  });

  it('signs in with Platform email + password', async () => {
    const user = userEvent.setup();
    login.mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText('Email'), 'Jack@jettx.ai');
    await user.type(screen.getByLabelText('Password'), 'platform-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(login).toHaveBeenCalledWith({
      email: 'Jack@jettx.ai',
      password: 'platform-password',
    });
    expect(startSignIn).not.toHaveBeenCalled();
  });

  it('remembers the staff email on the login form', () => {
    rememberStaffEmail('jack@jettx.ai');
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText('Email')).toHaveValue('jack@jettx.ai');
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use a different email' })).toBeInTheDocument();
  });

  it('queues an unknown employee for admin approval', async () => {
    const user = userEvent.setup();
    startSignIn.mockResolvedValue({ status: 'pending' });
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: /Need access\? Request an invite/i }));
    await user.type(screen.getByLabelText('First name'), 'Alex');
    await user.type(screen.getByLabelText('Last name'), 'Rivera');
    await user.type(screen.getByLabelText('Email'), 'alex@company.com');
    await user.click(screen.getByRole('button', { name: 'Request invite' }));

    expect(startSignIn).toHaveBeenCalledWith({
      firstName: 'Alex',
      lastName: 'Rivera',
      email: 'alex@company.com',
    });
    expect(await screen.findByText(/waiting on an Atmosphere admin/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(screen.getByRole('button', { name: 'Back to sign in' })).toBeInTheDocument();
  });

  it('sends already-invited requesters back to Platform password sign-in', async () => {
    const user = userEvent.setup();
    startSignIn.mockResolvedValue({ status: 'ready' });
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: /Need access\? Request an invite/i }));
    await user.type(screen.getByLabelText('First name'), 'Jack');
    await user.type(screen.getByLabelText('Last name'), 'Cyganiak');
    await user.type(screen.getByLabelText('Email'), 'jack@jettx.ai');
    await user.click(screen.getByRole('button', { name: 'Request invite' }));

    expect(await screen.findByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText(/Microsoft Authenticator/i)).toBeNull();
  });
});
