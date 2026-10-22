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

let phoneOn = true;
vi.mock('../../hooks/usePhoneAuthEnabled', () => ({ usePhoneAuthEnabled: () => phoneOn }));

let inAppShell = false;
vi.mock('../../lib/appShell', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/appShell')>();
  return { ...actual, isInAppShell: () => inAppShell };
});

import { InvitePanel, inviteKindHelp } from './InvitePanel';

describe('InvitePanel: Platform seats', () => {
  beforeEach(() => {
    phoneOn = true;
    inAppShell = false;
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

  it('offers one control with two choices: Field Capture, Platform (no Global Admin)', () => {
    render(<InvitePanel />);
    const radios = screen.getAllByRole('radio').filter((r) => r.closest('[data-testid="invite-seat-type"]'));
    expect(radios.map((r) => r.textContent)).toEqual(['Field Capture', 'Platform']);
    expect(screen.queryByRole('radio', { name: 'Global Admin' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'Field Capture' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByText('Seat')).toBeNull();
  });

  it('keeps the same row for every choice: nothing appears or disappears', async () => {
    render(<InvitePanel />);
    const row = screen.getByTestId('invite-row');
    const shape = () =>
      Array.from(row.querySelectorAll('input, button, [role="radiogroup"]')).map(
        (el) => el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.tagName,
      );
    const first = shape();
    for (const name of ['Platform', 'Field Capture']) {
      await userEvent.click(screen.getByRole('radio', { name }));
      expect(shape()).toEqual(first);
    }
    expect(screen.getByTestId('invite-via')).toBeInTheDocument();
  });

  it('has no tooltips on the choices', () => {
    render(<InvitePanel />);
    for (const name of ['Field Capture', 'Platform']) {
      expect(screen.getByRole('radio', { name })).not.toHaveAttribute('title');
    }
  });

  it('shows exactly one helper line that follows the choice', async () => {
    render(<InvitePanel />);
    const help = screen.getByTestId('invite-help');
    expect(await screen.findByText(/1 of 3 Field Capture seats used/)).toBe(help);
    expect(help).toHaveTextContent('Films jobs in Field Capture and uses the Platform. 1 of 3 Field Capture seats used.');
    await userEvent.click(screen.getByRole('radio', { name: 'Platform' }));
    expect(help).toHaveTextContent('Full Platform access except Billing and Usage, no Field Capture. $75/mo each. 1 of 2 in use.');
  });

  it('never says "0 of 0" for Platform seats', () => {
    expect(
      inviteKindHelp('platform', { inApp: false, platformSeats: { used: 0, allowed: 0, remaining: 0 } }),
    ).toBe('Full Platform access except Billing and Usage, no Field Capture. $75/mo each.');
  });

  it('drops prices in the phone app', () => {
    expect(inviteKindHelp('platform', { inApp: true, platformSeats: { used: 1, allowed: 2, remaining: 1 } })).toBe(
      'Full Platform access except Billing and Usage, no Field Capture. 1 of 2 in use.',
    );
  });

  it('maps each choice to the same API fields as before', async () => {
    render(<InvitePanel />);
    const email = screen.getByPlaceholderText('their@email.com');
    const send = async (name: string, address: string) => {
      await userEvent.click(screen.getByRole('radio', { name }));
      await userEvent.type(email, address);
      await userEvent.click(screen.getByRole('button', { name: /^invite$/i }));
      return createOrgInvite.mock.calls.at(-1)?.[0];
    };
    const fc = await send('Field Capture', 'crew@example.com');
    expect(fc).toMatchObject({ email: 'crew@example.com', role: 'employee' });
    expect(fc).not.toHaveProperty('seatType');
    const pl = await send('Platform', 'office@example.com');
    expect(pl).toMatchObject({ email: 'office@example.com', role: 'global_admin', seatType: 'platform' });
    expect(pl).not.toHaveProperty('serviceRole');
  });

  it('can invite a Platform seat by phone too', async () => {
    render(<InvitePanel />);
    await userEvent.click(screen.getByRole('radio', { name: 'Platform' }));
    await userEvent.click(screen.getByTestId('invite-via-phone'));
    await userEvent.type(screen.getByTestId('invite-phone'), '3125550100');
    await userEvent.click(screen.getByRole('checkbox', { name: /agreed to get a text/ }));
    await userEvent.click(screen.getByRole('button', { name: /^invite$/i }));
    expect(createOrgInvite.mock.calls.at(-1)?.[0]).toMatchObject({ phone: '+13125550100', smsConsent: true, role: 'global_admin', seatType: 'platform' });
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
    await userEvent.click(screen.getByRole('radio', { name: 'Platform' }));
    expect(await screen.findByTestId('platform-seat-unavailable')).toHaveTextContent("Platform seats aren't available yet.");
  });
});
