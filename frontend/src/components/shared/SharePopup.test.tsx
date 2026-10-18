import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobParty } from '../../lib/api';

const evidenceShares = vi.fn();
const sharedJob = vi.fn();
const addJobParty = vi.fn();
const revokeJobParty = vi.fn();
const getBillingOnboarding = vi.fn();
const phoneAuthConfig = vi.fn();

vi.mock('../../lib/api', () => ({
  api: {
    evidenceShares: (...args: unknown[]) => evidenceShares(...args),
    sharedJob: (...args: unknown[]) => sharedJob(...args),
    addJobParty: (...args: unknown[]) => addJobParty(...args),
    revokeJobParty: (...args: unknown[]) => revokeJobParty(...args),
    getBillingOnboarding: (...args: unknown[]) => getBillingOnboarding(...args),
    phoneAuthConfig: (...args: unknown[]) => phoneAuthConfig(...args),
  },
}));

import { SharePopup } from './SharePopup';

const party = (over: Partial<JobParty>): JobParty => ({
  id: 'p-1',
  company: 'Delgado Roofing',
  trade: null,
  contactName: null,
  email: 'crew@delgado.test',
  phone: null,
  role: 'subcontractor',
  invited_at: '2026-09-11T12:00:00Z',
  last_seen_at: null,
  revoked_at: null,
  acknowledgedRevision: null,
  clear: false,
  because: '',
  ...over,
});

describe('Share popup — crew', () => {
  beforeEach(() => {
    evidenceShares.mockReset().mockResolvedValue({ shares: [] });
    sharedJob.mockReset().mockResolvedValue({
      parties: [
        party({}),
        party({ id: 'p-2', company: 'Old Crew', revoked_at: '2026-09-12T00:00:00Z' }),
        party({ id: 'p-3', company: 'The Homeowner', role: 'owner' }),
      ],
    });
    addJobParty.mockReset().mockResolvedValue({ party: party({ id: 'p-9' }), emailed: true });
    revokeJobParty.mockReset().mockResolvedValue({ ok: true });
    getBillingOnboarding.mockReset().mockResolvedValue({ required: false, complete: true });
  });

  it('opens on Homeowner and switches to the crew invite', async () => {
    const user = userEvent.setup();
    render(<SharePopup jobId="job-1" onClose={() => undefined} />);

    expect(await screen.findByRole('heading', { name: 'Share' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Homeowner' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText(/homeowner email/i)).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Subcontractor or crew' }));
    expect(await screen.findByText('Delgado Roofing')).toBeInTheDocument();
    expect(screen.queryByText('The Homeowner')).toBeNull();
    expect(screen.queryByText('Old Crew')).toBeNull();
    expect(screen.getByRole('button', { name: 'Revoked (1)' })).toBeInTheDocument();
    expect(screen.queryByText(/trade/i, { selector: 'label, span, option' })).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('invites a crew with just a name and email', async () => {
    const user = userEvent.setup();
    render(<SharePopup jobId="job-1" onClose={() => undefined} initial="crew" />);

    await screen.findByText('Delgado Roofing');
    await user.type(screen.getByLabelText(/company or name/i), 'Smith Drywall');
    await user.type(screen.getByLabelText(/crew email/i), 'Jo@Smith.test');
    await user.click(screen.getByRole('button', { name: /send crew invite/i }));

    await waitFor(() =>
      expect(addJobParty).toHaveBeenCalledWith('job-1', {
        company: 'Smith Drywall',
        email: 'jo@smith.test',
        role: 'subcontractor',
      }),
    );
    expect(await screen.findByText(/Invite sent to jo@smith.test/)).toBeInTheDocument();
  });

  it('revokes a live crew invite', async () => {
    const user = userEvent.setup();
    render(<SharePopup jobId="job-1" onClose={() => undefined} initial="crew" />);

    await screen.findByText('Delgado Roofing');
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(revokeJobParty).toHaveBeenCalledWith('job-1', 'p-1');
  });
});

describe('SharePopup access variant (Access tab → Invite)', () => {
  beforeEach(() => {
    evidenceShares.mockReset().mockResolvedValue({ shares: [] });
    sharedJob.mockReset().mockResolvedValue({ parties: [] });
    addJobParty.mockReset();
    getBillingOnboarding.mockReset().mockResolvedValue({ planRequired: false });
    phoneAuthConfig.mockReset().mockResolvedValue({ enabled: true });
  });

  it('opens on Crew and invites a mobile number as crew', async () => {
    addJobParty.mockResolvedValue({ party: party({ email: null, phone: '+15550100000' }), texted: true });
    const onInvited = vi.fn();
    render(<SharePopup jobId="job-1" variant="access" onClose={() => {}} onInvited={onInvited} />);
    const user = userEvent.setup();
    expect(screen.getByTestId('access-invite-role')).toHaveTextContent('Crew');
    await user.click(screen.getByTestId('access-invite-role'));
    expect(screen.getByRole('option', { name: /Subcontractor/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Homeowner/ })).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: /Crew/ }));
    await user.click(await screen.findByRole('radio', { name: 'Phone' }));
    await user.type(screen.getByPlaceholderText('Delgado Roofing'), 'Sam Rivera');
    await user.type(screen.getByPlaceholderText('(555) 123-4567'), '3125550100');
    await user.click(screen.getByRole('button', { name: 'Text crew invite' }));
    await waitFor(() =>
      expect(addJobParty).toHaveBeenCalledWith('job-1', {
        company: 'Sam Rivera',
        phone: '+13125550100',
        role: 'subcontractor',
        serviceRole: 'crew',
      }),
    );
    await waitFor(() => expect(onInvited).toHaveBeenCalled());
    expect(await screen.findByText(/Invite texted to \(312\) 555-0100/)).toBeInTheDocument();
  });

  it('hides the mobile option when phone sign-in is off', async () => {
    phoneAuthConfig.mockResolvedValue({ enabled: false });
    render(<SharePopup jobId="job-1" variant="access" onClose={() => {}} />);
    await waitFor(() => expect(phoneAuthConfig).toHaveBeenCalled());
    expect(screen.queryByRole('radio', { name: 'Phone' })).not.toBeInTheDocument();
  });
});
