import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const jobEvidence = vi.fn();
const evidenceCustody = vi.fn();

vi.mock('../../lib/api', () => ({
  api: {
    jobEvidence: (...args: unknown[]) => jobEvidence(...args),
    evidenceCustody: (...args: unknown[]) => evidenceCustody(...args),
  },
}));

import { EvidenceLocker } from './EvidenceLocker';

const heldItem = {
  id: 'pf-4',
  title: 'After — Aug 04 (disputed)',
  company: 'Delgado Roofing',
  trade: 'roofing',
  workDate: '2026-08-04',
  category: 'issue',
  capturedAt: '2026-08-04T19:30:00Z',
  receivedAt: '2026-08-04T22:40:00Z',
  durationSeconds: 52,
  byteSize: 61_900_000,
  hasLocation: true,
  state: 'analysed',
  checks: [],
  aiSummary: null,
  legalHold: true,
  retentionUntil: null,
  contentHash: 'abc',
  viewCount: 5,
  lastViewedAt: '2026-08-06T09:15:00Z',
  tags: [],
};

describe('EvidenceLocker', () => {
  beforeEach(() => {
    jobEvidence.mockReset();
    evidenceCustody.mockReset();
    jobEvidence.mockResolvedValue({
      items: [heldItem],
      counts: { items: 1, onHold: 1, neverViewed: 0 },
    });
    evidenceCustody.mockResolvedValue({ entries: [] });
  });

  it('does not show legal hold controls on the job file', async () => {
    const user = userEvent.setup();
    render(<EvidenceLocker jobId="job-1038" />);

    expect(await screen.findByText('After — Aug 04 (disputed)')).toBeInTheDocument();
    expect(screen.queryByText('on hold')).not.toBeInTheDocument();
    expect(screen.queryByText('hold')).not.toBeInTheDocument();
    expect(screen.queryByText('Place on legal hold')).not.toBeInTheDocument();
    expect(screen.queryByText('Lift the hold')).not.toBeInTheDocument();

    await user.click(screen.getByText('After — Aug 04 (disputed)'));
    await waitFor(() => {
      expect(evidenceCustody).toHaveBeenCalledWith('job-1038', 'pf-4');
    });
    expect(screen.queryByText('Place on legal hold')).not.toBeInTheDocument();
    expect(screen.queryByText('Lift the hold')).not.toBeInTheDocument();
    expect(screen.queryByText('on hold — indefinite')).not.toBeInTheDocument();
  });
});
