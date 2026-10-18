import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createOrgInvite = vi.fn();
const orgInvites = vi.fn();
const getBillingOnboarding = vi.fn();

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
      getBillingOnboarding: (...args: unknown[]) => getBillingOnboarding(...args),
    },
  };
});

import { InvitePanel } from './InvitePanel';

describe('InvitePanel: Platform-only seats', () => {
  beforeEach(() => {
    createOrgInvite.mockReset().mockResolvedValue({
      invite: { id: 'inv-9', email: 'office@example.com', role: 'global_admin', seatType: 'platform', status: 'pending' },
      emailed: true,
    });
    orgInvites.mockReset().mockResolvedValue({
      invites: [
        { id: 'inv-8', email: 'pm@example.com', role: 'global_admin', seatType: 'platform', status: 'pending', createdAt: new Date().toISOString() },
      ],
    });
    getBillingOnboarding.mockReset().mockResolvedValue({
      required: false,
      complete: true,
      fieldCaptureSeats: { used: 1, allowed: 3, remaining: 2 },
      platformSeats: { used: 1, allowed: 2, remaining: 1, available: true },
    });
  });

  it('offers Field Capture vs Platform only ($75/mo) and shows the count in use', async () => {
    render(<InvitePanel />);
    expect(screen.getByRole('radio', { name: 'Field Capture' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Platform only, $75/mo' })).toBeInTheDocument();
    expect(await screen.findByText(/Platform seats: 1 of 2 in use/)).toBeInTheDocument();
  });

  it('a Platform invite sends seatType platform as a Global Admin, with no role picker', async () => {
    render(<InvitePanel />);
    await userEvent.click(screen.getByRole('radio', { name: 'Platform only, $75/mo' }));
    expect(screen.getByTestId('platform-seat-blurb')).toHaveTextContent(/except Billing and Usage/);
    expect(screen.queryByDisplayValue('Employee')).toBeNull();
    await userEvent.type(screen.getByPlaceholderText('their@email.com'), 'office@example.com');
    await userEvent.click(screen.getByRole('button', { name: /invite/i }));
    expect(createOrgInvite).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'office@example.com', role: 'global_admin', seatType: 'platform' }),
    );
  });

  it('puts the seat picker in the invite row, right after the email, with the explanation under it', () => {
    render(<InvitePanel />);
    const email = screen.getByPlaceholderText('their@email.com');
    const picker = screen.getByTestId('invite-seat-type');
    const form = email.closest('form');
    expect(form).not.toBeNull();
    expect(form).toContainElement(picker);
    expect(email.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('field-capture-seat-blurb')).toHaveTextContent(/Field Capture/);
    expect(form).not.toContainElement(screen.getByTestId('field-capture-seat-blurb'));
  });

  it('lists Platform invites as Platform', async () => {
    render(<InvitePanel />);
    expect(await screen.findByText(/^Platform · asked/)).toBeInTheDocument();
  });

  it("says Platform seats aren't available yet when none can be added", async () => {
    getBillingOnboarding.mockResolvedValue({
      required: false,
      complete: true,
      platformSeats: { used: 0, allowed: 0, remaining: 0, available: false },
    });
    render(<InvitePanel />);
    await userEvent.click(screen.getByRole('radio', { name: 'Platform only, $75/mo' }));
    expect(await screen.findByTestId('platform-seat-unavailable')).toHaveTextContent("Platform seats aren't available yet.");
  });
});
