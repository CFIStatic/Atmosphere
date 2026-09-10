import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProofResponse, SharedJobRecord } from '../../lib/api';

const jobProofs = vi.fn();

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      jobProofs: (...args: unknown[]) => jobProofs(...args),
    },
  };
});

vi.mock('./ProofOfWork', () => ({
  ProofOfWork: () => <div>Proof of work</div>,
}));

import { JobProgressDashboard } from './JobProgressDashboard';

const record: Pick<SharedJobRecord, 'job' | 'scope' | 'risks' | 'brief'> = {
  job: {
    id: 'job-1',
    title: 'Cedar Ridge rebuild',
    jobNumber: 1038,
    claimNumber: null,
    status: 'in_progress',
  },
  brief: null,
  risks: [
    {
      key: 'unacked',
      level: 'blocker',
      title: 'Sub has not accepted the scope',
      action: 'Do not let them start.',
    },
  ],
  scope: [
    {
      id: 'sc-1',
      party_id: null,
      state: 'included',
      title: 'Tear off and replace roof',
      detail: null,
      amount: null,
      reason: null,
      revision: 1,
      decided_at: null,
      created_at: '2026-08-01T00:00:00Z',
    },
    {
      id: 'sc-2',
      party_id: null,
      state: 'included',
      title: 'Rewire bedroom circuits',
      detail: null,
      amount: null,
      reason: null,
      revision: 1,
      decided_at: null,
      created_at: '2026-08-01T00:00:00Z',
    },
  ],
};

const proof: ProofResponse = {
  days: [
    {
      partyId: 'pty-2',
      company: 'Delgado Roofing',
      workDate: '2026-08-05',
      hasBefore: true,
      hasAfter: true,
      checks: [],
      contradicted: false,
      summary: 'North slope stripped.',
      payable: true,
      payableBecause: 'Before and after on file.',
      accepted: true,
      rejected: false,
      aiSummary: 'The north slope is stripped.',
      aiFindings: {
        scopeVerdicts: [
          {
            title: 'Tear off and replace roof',
            verdict: 'appears_complete',
            because: 'Slope stripped.',
          },
        ],
      },
      proofIds: ['pf-1'],
    },
  ],
  counts: { days: 1, payable: 1, contradicted: 0, awaitingAfter: 0 },
  siteKnown: true,
};

describe('JobProgressDashboard even simpler', () => {
  beforeEach(() => {
    jobProofs.mockReset();
  });

  it('shows one status sentence + progress, then Needs attention / Now / Done / Left — no dashboard chrome', async () => {
    render(
      <JobProgressDashboard
        jobId="job-1"
        record={record}
        initialProof={proof}
        showProofOfWork={false}
      />,
    );

    const status = await screen.findByTestId('job-progress-up-to-speed');
    expect(status).toHaveTextContent(/Needs your attention: Sub has not accepted the scope/);
    expect(status).not.toHaveTextContent(/Up to speed/i);

    expect(screen.getByTestId('job-progress-meter')).toHaveTextContent(/1 of 2 done/);
    // Demoted 3-stat jump line is gone
    expect(screen.getByTestId('job-progress-meter')).not.toHaveTextContent(/happening/);
    expect(screen.getByTestId('job-progress-meter')).not.toHaveTextContent(/still to do/i);

    expect(screen.getByRole('heading', { name: 'Needs attention' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Now' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Done' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Left' })).toBeInTheDocument();
    expect(screen.getByText('Nothing on site.')).toBeInTheDocument();

    // Old #390 titles / chrome
    expect(screen.queryByText('Up to speed')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Happening now' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Already finished' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Still to do' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Needs your attention' })).not.toBeInTheDocument();
    expect(screen.queryByText('Overall progress')).not.toBeInTheDocument();
    expect(screen.queryByText('Already done')).not.toBeInTheDocument();
    expect(screen.queryByText('Still ahead')).not.toBeInTheDocument();
  });

  it('omits Needs attention when there are no blockers or warnings', async () => {
    render(
      <JobProgressDashboard
        jobId="job-1"
        record={{ ...record, risks: [] }}
        initialProof={proof}
        showProofOfWork={false}
      />,
    );

    expect(await screen.findByTestId('job-progress-up-to-speed')).toHaveTextContent(
      /Crews finished 1 of 2 work items/,
    );
    expect(screen.queryByRole('heading', { name: 'Needs attention' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('job-progress-needs-attention')).not.toBeInTheDocument();
  });
});
