import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const homeownerEmailSignIn = vi.fn();
vi.mock('../lib/api', () => ({
  ApiError: class extends Error { code = ''; },
  api: {
    homeownerEmailSignIn: (...a: unknown[]) => homeownerEmailSignIn(...a),
    homeownerVerifyEmailSignIn: vi.fn(),
  },
}));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ adoptUser: vi.fn() }) }));
vi.mock('../lib/homeownerPortal', () => ({ forgetHomeownerCache: vi.fn() }));

import { HomeownerEmailSignIn } from './HomeownerEmailSignIn';

describe('HomeownerEmailSignIn', () => {
  beforeEach(() => sessionStorage.clear());

  it('emails a code with no password and answers the same for every email', async () => {
    homeownerEmailSignIn.mockResolvedValue({ ok: true });
    render(<MemoryRouter><HomeownerEmailSignIn onBack={() => {}} /></MemoryRouter>);
    expect(screen.queryByLabelText(/password/i)).toBeNull();
    await userEvent.type(screen.getByLabelText(/Email the job was shared with/), 'home@example.com');
    await userEvent.click(screen.getByRole('button', { name: /Email me a code/ }));
    await waitFor(() => expect(homeownerEmailSignIn).toHaveBeenCalledWith('home@example.com'));
    expect(screen.getByRole('status')).toHaveTextContent(/If a contractor shared a job with home@example.com/);
  });

  it('keeps the code box after a reload', async () => {
    homeownerEmailSignIn.mockResolvedValue({ ok: true });
    const first = render(<MemoryRouter><HomeownerEmailSignIn onBack={() => {}} /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText(/Email the job was shared with/), 'home@example.com');
    await userEvent.click(screen.getByRole('button', { name: /Email me a code/ }));
    await screen.findByLabelText('Code from the email');
    first.unmount();
    render(<MemoryRouter><HomeownerEmailSignIn onBack={() => {}} /></MemoryRouter>);
    expect(screen.getByLabelText('Code from the email')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/home@example.com/);
  });
});
