import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
const createOrgInvite = vi.fn();
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ membership: { role: 'global_admin', org: { id: 'o' } } }) }));
vi.mock('../../hooks/usePhoneAuthEnabled', () => ({ usePhoneAuthEnabled: () => true }));
vi.mock('../../lib/api', async (orig) => { const a = await orig<typeof import('../../lib/api')>(); return { ...a, api: { ...a.api,
  createOrgInvite: (...x: unknown[]) => createOrgInvite(...x), orgInvites: async () => ({ invites: [] }),
  getBillingWorkspace: async () => ({}), getBillingOnboarding: async () => ({ required: false, complete: true }) } }; });
import { InvitePanel } from './InvitePanel';
describe('InvitePanel Email | Phone toggle', () => { it('switches to Phone and sends a phone invite', async () => {
  createOrgInvite.mockResolvedValue({ invite: { id: '1' }, emailed: false, texted: true });
  render(<InvitePanel />);
  expect(await screen.findByRole('radio', { name: 'Email' })).toHaveAttribute('aria-checked', 'true');
  await userEvent.click(screen.getByRole('radio', { name: 'Phone' }));
  expect(screen.getByTestId('invite-phone')).toHaveAttribute('placeholder', '(555) 123-4567');
  await userEvent.type(screen.getByTestId('invite-phone'), '3125550100');
  await userEvent.click(screen.getByRole('button', { name: /^invite$/i }));
  expect(createOrgInvite).toHaveBeenCalledWith(expect.objectContaining({ phone: '+13125550100', role: 'employee' }));
  expect(await screen.findByText(/texted \(312\) 555-0100/)).toBeInTheDocument();
});
  it('switches back to Email', async () => {
    render(<InvitePanel />);
    await userEvent.click(await screen.findByRole('radio', { name: 'Phone' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Email' }));
    expect(screen.getByPlaceholderText('their@email.com')).toBeInTheDocument();
    expect(screen.queryByText(/No email\? Invite by phone/)).toBeNull();
  });
});
