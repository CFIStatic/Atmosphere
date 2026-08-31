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
  label: 'Homeowner',
  kind: 'progress',
  recipientEmail: 'jack@example.com',
  path: '/progress/abc',
  createdAt: '2026-08-22T00:00:00.000Z',
  expiresAt: '2026-09-21T00:00:00.000Z',
  revokedAt: null,
  lastOpenedAt: null,
  openCount: 0,
  state: 'live',
};

const created: CreateEvidenceShareResult = {
  share: {
    id: 'share-2',
    label: 'Attorney',
    kind: 'progress',
    expiresAt: '2026-09-21T00:00:00.000Z',
    createdAt: '2026-08-22T00:00:00.000Z',
    path: '/progress/new-token',
  },
  emailed: false,
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

  it('invites without a copy-link action and keeps fields on the same surface', async () => {
    render(<ShareJobProgressPanel jobId="job-1" modal creating onClose={() => undefined} />);

    expect(await screen.findByText('Homeowner')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /copy link/i })).toBeNull();
    expect(screen.getByRole('button', { name: /revoke/i })).toBeInTheDocument();

    const email = screen.getByLabelText(/email them/i);
    expect(email).toHaveAttribute('placeholder', 'homeowner@example.com');
    expect(email).toHaveClass('glass-field');
    expect(screen.getByLabelText(/who is this for/i)).toHaveClass('glass-field');
    expect(screen.getByLabelText(/link expires/i)).toHaveClass('glass-field');

    const submit = screen.getByRole('button', { name: /create share/i });
    expect(submit.className).toContain('bg-ink-900');
    expect(submit.className).not.toContain('bg-brand-');
  });

  it('confirms a new share without exposing a copyable invite URL', async () => {
    const user = userEvent.setup();
    render(<ShareJobProgressPanel jobId="job-1" modal creating onClose={() => undefined} />);

    await screen.findByText('Homeowner');
    await user.type(screen.getByLabelText(/who is this for/i), 'Attorney');
    await user.click(screen.getByRole('button', { name: /create share/i }));

    expect(await screen.findByText('Share created. It is listed below.')).toBeInTheDocument();
    expect(screen.queryByText('/progress/new-token')).toBeNull();
    expect(screen.queryByRole('button', { name: /copy link/i })).toBeNull();
    expect(screen.queryByText(/copy it and send it yourself/i)).toBeNull();
    await waitFor(() => {
      expect(createProgressShare).toHaveBeenCalledWith({
        jobId: 'job-1',
        label: 'Attorney',
        recipientEmail: undefined,
        expiresInDays: 30,
      });
    });
  });
});
