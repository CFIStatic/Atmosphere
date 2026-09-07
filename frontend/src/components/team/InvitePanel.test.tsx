import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createOrgInvite = vi.fn();
const orgInvites = vi.fn();
const getBillingWorkspace = vi.fn();

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    membership: { role: 'global_admin', org: { id: 'org-1', name: 'Jett', joinCode: 'ABC123' } },
  }),
}));

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      createOrgInvite: (...args: unknown[]) => createOrgInvite(...args),
      orgInvites: (...args: unknown[]) => orgInvites(...args),
      getBillingWorkspace: (...args: unknown[]) => getBillingWorkspace(...args),
    },
  };
});

import { ApiError } from '../../lib/api';
import { InvitePanel } from './InvitePanel';

describe('InvitePanel', () => {
  beforeEach(() => {
    createOrgInvite.mockReset();
    orgInvites.mockReset().mockResolvedValue({ invites: [] });
    getBillingWorkspace.mockReset().mockResolvedValue({
      fieldCaptureSeats: { used: 3, allowed: 3, included: 3, extra: 0, remaining: 0 },
    });
    vi.stubGlobal('location', { href: 'http://localhost/settings?section=organization' });
  });

  it('does not show a Billing-page Add seat button', async () => {
    render(<InvitePanel />);
    expect(await screen.findByText(/Field Capture accounts: 3 of 3 in use/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add a Field Capture seat/i })).toBeNull();
  });

  it('redirects to Stripe Checkout when invite needs a subscription', async () => {
    createOrgInvite.mockRejectedValue(
      new ApiError(
        402,
        'Finish Work Verification checkout to add Field Capture seats, then send the invite again.',
        'fc_seat_checkout',
        'https://checkout.stripe.test/session',
      ),
    );

    render(<InvitePanel />);
    await userEvent.type(screen.getByPlaceholderText('their@email.com'), 'crew@example.com');
    await userEvent.click(screen.getByRole('button', { name: /invite/i }));

    expect(createOrgInvite).toHaveBeenCalled();
    expect(window.location.href).toBe('https://checkout.stripe.test/session');
  });

  it('completes an invite when the server auto-adds a seat', async () => {
    createOrgInvite.mockResolvedValue({
      invite: { id: 'inv-1', email: 'crew@example.com', role: 'employee', status: 'pending' },
      emailed: true,
      joinCode: 'ABC123',
    });

    render(<InvitePanel />);
    await userEvent.type(screen.getByPlaceholderText('their@email.com'), 'crew@example.com');
    await userEvent.click(screen.getByRole('button', { name: /invite/i }));

    expect(await screen.findByText(/Invited — Atmosphere emailed crew@example.com/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add a Field Capture seat/i })).toBeNull();
  });
});
