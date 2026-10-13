import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loginWithPhone = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => null));
const phoneAuthStart = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => ({ ok: true, phone: '+13125550100' })));

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ loginWithPhone }) }));
vi.mock('../lib/api', () => ({
  api: { phoneAuthStart: (...a: unknown[]) => phoneAuthStart(...a) },
  ApiError: class ApiError extends Error {},
}));

import { PhoneSignIn } from './PhoneSignIn';

describe('PhoneSignIn', () => {
  beforeEach(() => {
    loginWithPhone.mockClear();
    phoneAuthStart.mockClear();
  });

  it('texts a code to the E.164 number, then signs in with it', async () => {
    const onSignedIn = vi.fn();
    render(<PhoneSignIn intent="signin" onSignedIn={onSignedIn} />);
    const send = screen.getByRole('button', { name: 'Text me a code' });
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Mobile number'), '3125550100');
    expect(screen.getByLabelText('Mobile number')).toHaveValue('(312) 555-0100');
    await userEvent.click(send);
    expect(phoneAuthStart).toHaveBeenCalledWith('+13125550100', 'signin');
    expect(await screen.findByText('(312) 555-0100')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Resend in/ })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Code'), '12a3456');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(loginWithPhone).toHaveBeenCalledWith('+13125550100', '123456', undefined));
    expect(onSignedIn).toHaveBeenCalled();
  });

  it('sign-up waits for the rest of the form and passes the terms version', async () => {
    const { rerender } = render(
      <PhoneSignIn intent="signup" initialPhone="+13125550100" termsReady={false} acceptedTermsVersion="v9" onSignedIn={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Text me a code' })).toBeDisabled();
    rerender(<PhoneSignIn intent="signup" initialPhone="+13125550100" termsReady acceptedTermsVersion="v9" onSignedIn={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Text me a code' }));
    expect(phoneAuthStart).toHaveBeenCalledWith('+13125550100', 'signup');
    await userEvent.type(await screen.findByLabelText('Code'), '654321');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(loginWithPhone).toHaveBeenCalledWith('+13125550100', '654321', 'v9'));
  });
});
