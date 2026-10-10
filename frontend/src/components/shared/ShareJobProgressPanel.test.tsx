import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateEvidenceShareResult, EvidenceShare } from '../../lib/api';

const evidenceShares = vi.fn();
const createProgressShare = vi.fn();
const revokeEvidenceShare = vi.fn();
const getBillingOnboarding = vi.fn();

vi.mock('../../lib/api', () => ({
  api: {
    evidenceShares: (...args: unknown[]) => evidenceShares(...args),
    createProgressShare: (...args: unknown[]) => createProgressShare(...args),
    revokeEvidenceShare: (...args: unknown[]) => revokeEvidenceShare(...args),
    getBillingOnboarding: (...args: unknown[]) => getBillingOnboarding(...args),
  },
}));

import { SharePopup } from './SharePopup';

const liveShare: EvidenceShare = {
  id: 'share-1',
  jobId: 'job-1',
  label: 'jack@example.com',
  kind: 'progress',
  recipientEmail: 'jack@example.com',
  path: '/progress/abc',
  createdAt: '2026-08-22T00:00:00.000Z',
  expiresAt: null,
  revokedAt: null,
  lastOpenedAt: null,
  openCount: 0,
  state: 'live',
};

const created: CreateEvidenceShareResult = {
  share: {
    id: 'share-2',
    label: 'jordan@example.com',
    kind: 'progress',
    expiresAt: null,
    createdAt: '2026-08-22T00:00:00.000Z',
    path: '/progress/new-token',
  },
  emailed: true,
  recipientHasAccount: false,
};

describe('Share popup — homeowner', () => {
  beforeEach(() => {
    evidenceShares.mockReset();
    createProgressShare.mockReset();
    revokeEvidenceShare.mockReset();
    getBillingOnboarding.mockReset().mockResolvedValue({ required: false, complete: true });
    evidenceShares.mockResolvedValue({ shares: [liveShare] });
    createProgressShare.mockResolvedValue(created);
  });

  it('is just an email field and a send button — no label, expiry, or copy link', async () => {
    render(<SharePopup jobId="job-1" onClose={() => undefined} />);

    expect(
      await screen.findByRole('heading', { name: 'Share' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/job-progress link/i)).toBeInTheDocument();
    expect(screen.getByText(/Not a film invite/i)).toBeInTheDocument();
    expect(screen.getByText('jack@example.com')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /copy link/i })).toBeNull();
    expect(screen.queryByLabelText(/who is this for/i)).toBeNull();
    expect(screen.queryByLabelText(/link expires/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /create share/i })).toBeNull();

    const email = screen.getByLabelText(/homeowner email/i);
    expect(email).toHaveAttribute('type', 'email');
    expect(email).toHaveAttribute('required');
    expect(email).toHaveClass('glass-field');

    const submit = screen.getByRole('button', { name: /send homeowner invite/i });
    expect(submit).toBeDisabled();
    expect(submit.className).toContain('bg-ink-900');
  });

  it('emails the invite and does not show the link', async () => {
    const user = userEvent.setup();
    render(<SharePopup jobId="job-1" onClose={() => undefined} />);

    await screen.findByText('jack@example.com');
    await user.type(screen.getByLabelText(/homeowner email/i), 'jordan@example.com');
    await user.click(screen.getByRole('button', { name: /send homeowner invite/i }));

    expect(await screen.findByText('Invite sent to jordan@example.com.')).toBeInTheDocument();
    expect(screen.queryByText('/progress/new-token')).toBeNull();
    expect(screen.queryByRole('button', { name: /copy link/i })).toBeNull();
    await waitFor(() => {
      expect(createProgressShare).toHaveBeenCalledWith({
        jobId: 'job-1',
        label: 'jordan@example.com',
        recipientEmail: 'jordan@example.com',
      });
    });
  });

  it('shows the server error when the invite email does not send', async () => {
    createProgressShare.mockRejectedValueOnce(
      new Error('Atmosphere mail is not configured, so the invite was not sent.'),
    );
    const user = userEvent.setup();
    render(<SharePopup jobId="job-1" onClose={() => undefined} />);

    await screen.findByText('jack@example.com');
    await user.type(screen.getByLabelText(/homeowner email/i), 'jordan@example.com');
    await user.click(screen.getByRole('button', { name: /send homeowner invite/i }));

    expect(
      await screen.findByText('Atmosphere mail is not configured, so the invite was not sent.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/invite sent/i)).toBeNull();
  });

  it('previews the homeowner share but refuses to send while unpaid', async () => {
    getBillingOnboarding.mockResolvedValue({ required: true, complete: false });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/job-progress?job=job-1']}>
        <SharePopup jobId="job-1" onClose={() => undefined} />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('upgrade-prompt')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Choose a plan' }).getAttribute('href')).toContain(
      '/signup?step=2',
    );
    await user.type(screen.getByLabelText(/homeowner email/i), 'jordan@example.com');
    await user.click(screen.getByRole('button', { name: /send homeowner invite/i }));
    expect(createProgressShare).not.toHaveBeenCalled();
  });

  it('folds revoked invites under a toggle and closes from the icon button', async () => {
    evidenceShares.mockResolvedValue({
      shares: [
        liveShare,
        {
          ...liveShare,
          id: 'old-1',
          recipientEmail: 'old@example.com',
          label: 'old@example.com',
          state: 'revoked',
        },
      ],
    });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<SharePopup jobId="job-1" onClose={onClose} />);

    expect(await screen.findByText('jack@example.com')).toBeInTheDocument();
    expect(screen.queryByText('old@example.com')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Revoked (1)' }));
    expect(screen.getByText('old@example.com')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});
