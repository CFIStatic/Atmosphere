import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createOrgInvite = vi.fn();
const orgInvites = vi.fn();
const getBillingOnboarding = vi.fn();

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    membership: { role: 'global_admin', permissionRole: 'admin', org: { id: 'org-1', name: 'Jett', joinCode: 'ABC123' } },
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
vi.mock('../../lib/appShell', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/appShell')>();
  return { ...actual, isInAppShell: () => false };
});

import { InvitePanel, memberPermissionRole, PERMISSION_ROLE_HELP } from './InvitePanel';

describe('InvitePanel: one role dropdown, both products always', () => {
  beforeEach(() => {
    phoneOn = true;
    createOrgInvite.mockReset().mockResolvedValue({
      invite: { id: 'inv-9', email: 'office@example.com', role: 'employee', status: 'pending' },
      emailed: true,
    });
    orgInvites.mockReset().mockResolvedValue({
      invites: [
        { id: 'inv-8', email: 'pm@example.com', role: 'employee', permissionRole: 'viewer', status: 'pending', createdAt: new Date().toISOString() },
        { id: 'inv-7', email: 'old@example.com', role: 'global_admin', seatType: 'platform', status: 'pending', createdAt: new Date().toISOString() },
      ],
    });
    getBillingOnboarding.mockReset().mockResolvedValue({
      required: false,
      complete: true,
      fieldCaptureSeats: { used: 1, allowed: 3, remaining: 2 },
    });
  });

  it('has no product choice and one role dropdown: Member (default), Admin, Viewer', () => {
    render(<InvitePanel />);
    expect(screen.queryByTestId('invite-seat-type')).toBeNull();
    expect(screen.queryByText(/Platform only|Field Capture only/)).toBeNull();
    const select = screen.getByRole('combobox', { name: 'Role' }) as HTMLSelectElement;
    expect(select.value).toBe('member');
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['Member', 'Admin', 'Viewer']);
    expect(screen.queryByRole('option', { name: 'Owner' })).toBeNull();
  });

  it('shows one plain line for the chosen role, and the seat count', async () => {
    render(<InvitePanel />);
    expect(screen.getByTestId('invite-role-help')).toHaveTextContent(PERMISSION_ROLE_HELP.member);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Role' }), 'viewer');
    expect(screen.getByTestId('invite-role-help')).toHaveTextContent(PERMISSION_ROLE_HELP.viewer);
    expect(await screen.findByText(/1 of 3 seats used/)).toBeInTheDocument();
    expect(screen.getByTestId('invite-help')).toHaveTextContent('Gets Field Capture and Platform.');
  });

  it.each(['member', 'admin', 'viewer'] as const)('sends permissionRole %s, never a seat type, by email', async (role) => {
    render(<InvitePanel />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Role' }), role);
    await userEvent.type(screen.getByPlaceholderText('their@email.com'), 'crew@example.com');
    await userEvent.click(screen.getByRole('button', { name: /invite/i }));
    expect(createOrgInvite).toHaveBeenCalledWith({ email: 'crew@example.com', role: 'employee', permissionRole: role });
  });

  it('sends the role by phone too', async () => {
    render(<InvitePanel />);
    await userEvent.click(screen.getByTestId('invite-via-phone'));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Role' }), 'admin');
    await userEvent.type(screen.getByTestId('invite-phone'), '3125550100');
    await userEvent.click(screen.getByTestId('invite-sms-consent').querySelector('input')!);
    await userEvent.click(screen.getByRole('button', { name: /invite/i }));
    expect(createOrgInvite).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '+13125550100', smsConsent: true, role: 'employee', permissionRole: 'admin' }),
    );
    expect(createOrgInvite.mock.calls[0][0]).not.toHaveProperty('seatType');
  });

  it('lists pending invites by role; a legacy Platform invite reads Member', async () => {
    render(<InvitePanel />);
    expect(await screen.findByText(/Viewer · asked/)).toBeInTheDocument();
    expect(screen.getByText(/Member · asked/)).toBeInTheDocument();
  });

  it('memberPermissionRole falls back to the old meaning', () => {
    expect(memberPermissionRole({ role: 'global_admin' })).toBe('admin');
    expect(memberPermissionRole({ role: 'employee' })).toBe('member');
    expect(memberPermissionRole({ role: 'employee', permissionRole: 'viewer' })).toBe('viewer');
  });
});
