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

  it('asks for first name, last name, and email — not a password or shared code', () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Internal' })).toBeInTheDocument();
    expect(screen.getByLabelText('First name')).toBeInTheDocument();
    expect(screen.getByLabelText('Last name')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.queryByLabelText('Access code')).toBeNull();
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /demo/i })).toBeNull();
  });

  it('shows a Microsoft Authenticator QR on first enrollment', async () => {
    const user = userEvent.setup();
    startSignIn.mockResolvedValue({
      status: 'enroll',
      challenge: 'tok',
      otpauthUrl: 'otpauth://totp/Atmosphere%20Internal:jack@jettx.ai',
      qrDataUrl: 'data:image/png;base64,aaa',
      secret: 'JBSWY3DPEHPK3PXP',
      issuer: 'Atmosphere Internal',
    });
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText('First name'), 'Jack');
    await user.type(screen.getByLabelText('Last name'), 'Cyganiak');
    await user.type(screen.getByLabelText('Email'), 'jack@jettx.ai');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(startSignIn).toHaveBeenCalledWith({
      firstName: 'Jack',
      lastName: 'Cyganiak',
      email: 'jack@jettx.ai',
    });
    expect(await screen.findByAltText('QR code for Microsoft Authenticator')).toBeInTheDocument();
    expect(screen.getByText(/Other account/)).toBeInTheDocument();
    expect(screen.getByText(/Setup key: JBSWY3DPEHPK3PXP/)).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByText(/6-digit code from Microsoft Authenticator/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('queues an unknown employee for admin approval', async () => {
    const user = userEvent.setup();
    startSignIn.mockResolvedValue({ status: 'pending' });
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText('First name'), 'Alex');
    await user.type(screen.getByLabelText('Last name'), 'Rivera');
    await user.type(screen.getByLabelText('Email'), 'alex@company.com');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(startSignIn).toHaveBeenCalledWith({
      firstName: 'Alex',
      lastName: 'Rivera',
      email: 'alex@company.com',
    });
    expect(await screen.findByText(/waiting on an Atmosphere admin/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(screen.getByRole('button', { name: 'Request another email' })).toBeInTheDocument();
  });

  it('asks only for the authenticator code after enrollment', async () => {
    const user = userEvent.setup();
    startSignIn.mockResolvedValue({ status: 'code', challenge: 'tok' });
    login.mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText('First name'), 'Jack');
    await user.type(screen.getByLabelText('Last name'), 'Cyganiak');
    await user.type(screen.getByLabelText('Email'), 'jack@jettx.ai');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByLabelText('Password')).toBeInTheDocument();
    expect(screen.queryByAltText('QR code for Microsoft Authenticator')).toBeNull();
    await user.type(screen.getByLabelText('Password'), '123456');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(login).toHaveBeenCalledWith({ challenge: 'tok', code: '123456' });
  });

  it('uses the authenticator code as the password after the first setup', async () => {
    const user = userEvent.setup();
    rememberStaffEmail('jack@jettx.ai');
    startSignIn.mockResolvedValue({ status: 'code', challenge: 'tok' });
    login.mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(screen.queryByLabelText('First name')).toBeNull();
    expect(screen.getByLabelText('Email')).toHaveValue('jack@jettx.ai');
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByText(/6-digit code is your password/)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Password'), '654321');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(startSignIn).toHaveBeenCalledWith({ email: 'jack@jettx.ai' });
    expect(login).toHaveBeenCalledWith({ email: 'jack@jettx.ai', code: '654321' });
  });
});
