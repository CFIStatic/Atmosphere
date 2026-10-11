import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

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
  it('emails a link with no password and answers the same for every email', async () => {
    homeownerEmailSignIn.mockResolvedValue({ ok: true });
    render(<MemoryRouter><HomeownerEmailSignIn onBack={() => {}} /></MemoryRouter>);
    expect(screen.queryByLabelText(/password/i)).toBeNull();
    await userEvent.type(screen.getByLabelText(/Email the job was shared with/), 'home@example.com');
    await userEvent.click(screen.getByRole('button', { name: /Email me a link/ }));
    await waitFor(() => expect(homeownerEmailSignIn).toHaveBeenCalledWith('home@example.com'));
    expect(screen.getByRole('status')).toHaveTextContent(/If a contractor shared a job with home@example.com/);
  });
});
