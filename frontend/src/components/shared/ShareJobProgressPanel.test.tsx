import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateEvidenceShareResult, EvidenceShare } from '../../lib/api';

const evidenceShares = vi.fn();
const createProgressShare = vi.fn();
const revokeEvidenceShare = vi.fn();

vi.mock('../../lib/api', () => ({
  api: {
    evidenceShares: (...args: unknown[]) => evidenceShares(...args),
    createProgressShare: (...args: unknown[]) => createProgressShare(...args),
    revokeEvidenceShare: (...args: unknown[]) => revokeEvidenceShare(...args),
  },
}));

import { ShareJobProgressPanel } from './ShareJobProgressPanel';

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

describe('ShareJobProgressPanel', () => {
  beforeEach(() => {
    evidenceShares.mockReset();
    createProgressShare.mockReset();
    revokeEvidenceShare.mockReset();
    evidenceShares.mockResolvedValue({ shares: [liveShare] });
    createProgressShare.mockResolvedValue(created);
  });

  it('is just an email field and a send button — no label, expiry, or copy link', async () => {
    render(<ShareJobProgressPanel jobId="job-1" modal creating onClose={() => undefined} />);

    expect(await screen.findByRole('heading', { name: 'Invite by email' })).toBeInTheDocument();
    expect(screen.getByText(/View and Ask links/i)).toBeInTheDocument();
    expect(screen.getByText('jack@example.com')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /copy link/i })).toBeNull();
    expect(screen.queryByLabelText(/who is this for/i)).toBeNull();
    expect(screen.queryByLabelText(/link expires/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /create share/i })).toBeNull();

    const email = screen.getByLabelText(/^email$/i);
    expect(email).toHaveAttribute('type', 'email');
    expect(email).toHaveAttribute('required');
    expect(email).toHaveClass('glass-field');

    const submit = screen.getByRole('button', { name: /send invite/i });
    expect(submit).toBeDisabled();
    expect(submit.className).toContain('bg-ink-900');
  });

  it('emails the invite and does not show the link', async () => {
    const user = userEvent.setup();
    render(<ShareJobProgressPanel jobId="job-1" modal creating onClose={() => undefined} />);

    await screen.findByText('jack@example.com');
    await user.type(screen.getByLabelText(/^email$/i), 'jordan@example.com');
    await user.click(screen.getByRole('button', { name: /send invite/i }));

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
    render(<ShareJobProgressPanel jobId="job-1" modal creating onClose={() => undefined} />);

    await screen.findByText('jack@example.com');
    await user.type(screen.getByLabelText(/^email$/i), 'jordan@example.com');
    await user.click(screen.getByRole('button', { name: /send invite/i }));

    expect(
      await screen.findByText('Atmosphere mail is not configured, so the invite was not sent.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/invite sent/i)).toBeNull();
  });
});
