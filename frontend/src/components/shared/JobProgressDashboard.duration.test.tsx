import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ProofResponse } from '../../lib/api';
import { JobProgressDashboard } from './JobProgressDashboard';

const proof: ProofResponse = {
  siteKnown: true,
  counts: { days: 1, payable: 0, contradicted: 0, awaitingAfter: 0 },
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
      payableBecause: 'Checks passed.',
      accepted: true,
      rejected: false,
      aiSummary: 'North slope stripped and dried in.',
      aiFindings: null,
      proofIds: ['pf-1', 'pf-2'],
      proofClips: [
        { id: 'pf-1', durationSeconds: 68 },
        { id: 'pf-2', durationSeconds: 94 },
      ],
    },
  ],
};

describe('JobProgressDashboard field-video clocks', () => {
  it('prints clip length on the timeline and in Field video', () => {
    render(
      <JobProgressDashboard
        jobId="job-1038"
        readOnly
        initialProof={proof}
        record={{
          job: {
            id: 'job-1038',
            jobNumber: 1038,
            title: 'Cedar Ridge',
            status: 'in_progress',
            claimNumber: null,
          },
          scope: [],
          risks: [],
          brief: null,
        }}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Field video' })).toBeInTheDocument();
    expect(screen.getAllByText('1:08 · 1:34').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('0:00')).toBeNull();
  });
});
