import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
const textOrgInvite = vi.fn();
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ membership: { role: 'global_admin', org: { id: 'o' } } }) }));
vi.mock('../../hooks/usePhoneAuthEnabled', () => ({ usePhoneAuthEnabled: () => true }));
vi.mock('../../lib/api', async (orig) => { const a = await orig<typeof import('../../lib/api')>(); return { ...a, api: { ...a.api,
  textOrgInvite: (...x: unknown[]) => textOrgInvite(...x),
  orgInvites: async () => ({ invites: [
    { id: 'p', email: null, phone: '+13125550100', role: 'employee', status: 'pending', createdAt: new Date().toISOString() },
    { id: 'e', email: 'a@b.co', phone: null, role: 'employee', status: 'pending', createdAt: new Date().toISOString() },
  ] }),
  getBillingWorkspace: async () => ({}), getBillingOnboarding: async () => ({ required: false, complete: true }) } }; });
import { InvitePanel } from './InvitePanel';

describe('InvitePanel text again', () => {
  it('offers Text again only on phone invites and reports a sent text', async () => {
    textOrgInvite.mockResolvedValue({ texted: true, textStatus: 'sent' });
    render(<InvitePanel />);
    const buttons = await screen.findAllByTestId('invite-text-again');
    expect(buttons).toHaveLength(1);
    await userEvent.click(buttons[0]);
    expect(textOrgInvite).toHaveBeenCalledWith('p');
    expect(await screen.findByText(/Texted \(312\) 555-0100 the invite link again/)).toBeInTheDocument();
  });

  it('says when team texting is not set up', async () => {
    textOrgInvite.mockResolvedValue({ texted: false, textStatus: 'not_configured' });
    render(<InvitePanel />);
    await userEvent.click(await screen.findByTestId('invite-text-again'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/team texting isn't set up yet/);
  });
});
