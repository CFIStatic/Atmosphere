import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { JobProgressDashboard } from './JobProgressDashboard';

vi.mock('./ProofOfWork', () => ({
  ProofOfWork: () => <div>Proof of work</div>,
}));

const record = {
  job: {
    id: 'job-1038',
    jobNumber: 1038,
    title: 'Cedar Ridge — storm damage',
    claimNumber: 'CLM-1',
    status: 'in_progress',
  },
  brief: null,
  scope: [
    {
      id: 'sc-1',
      party_id: null,
      state: 'included' as const,
      title: 'Tear off north slope',
      detail: null,
      amount: null,
      reason: null,
      revision: 1,
      decided_at: null,
      created_at: '2026-08-01T00:00:00Z',
    },
  ],
  risks: [],
};

const emptyProof = {
  days: [],
  counts: { days: 0, payable: 0, contradicted: 0, awaitingAfter: 0 },
  siteKnown: false,
};

describe('JobProgressDashboard', () => {
  it('does not render Happening now / Already done / Still ahead summary cards', () => {
    render(
      <JobProgressDashboard
        jobId="job-1038"
        record={record}
        initialProof={emptyProof}
        showProofOfWork={false}
      />,
    );

    expect(screen.queryByText('Already done')).toBeNull();
    expect(screen.queryByText('Still ahead')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Happening now' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Happening now' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What happened' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What’s next' })).toBeInTheDocument();
  });
});
