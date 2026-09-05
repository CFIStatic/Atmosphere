import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { JobScopeItem, ProofQuestion, ProofResponse, SharedJobRecord } from '../../lib/api';
import { JobFileTodayStrip } from './JobFileTodayStrip';

const now = new Date('2026-09-05T15:00:00-05:00');

const record: SharedJobRecord = {
  job: {
    id: 'job-1038',
    jobNumber: 1038,
    title: 'Cedar Ridge — storm damage',
    status: 'in_progress',
    claimNumber: 'CLM-1',
  },
  brief: null,
  revisions: [],
  currentRevision: 1,
  parties: [],
  scope: [
    {
      id: 'sc-new',
      party_id: null,
      state: 'included',
      title: 'Replace valley flashing',
      detail: null,
      amount: null,
      reason: null,
      revision: 1,
      decided_at: null,
      created_at: '2026-09-05T13:00:00Z',
    },
  ] satisfies JobScopeItem[],
  money: { approved: 0, pending: 0, unpricedApprovals: 0 },
  messages: [],
  risks: [],
};

const proofs: ProofResponse = {
  days: [],
  videos: [
    {
      id: 'p-today',
      partyId: 'pty-1',
      company: 'Delgado Roofing',
      workDate: '2026-09-05',
      phase: 'after',
      durationSeconds: 40,
      analysisStatus: 'done',
      narrationStatus: 'done',
      transcriptStatus: 'done',
      transcriptError: null,
      aiSummary: 'New flashing on the valley.',
      heardOnMic: null,
      receivedAt: '2026-09-05T14:10:00Z',
    },
  ],
  counts: { days: 0, videos: 1, payable: 0, contradicted: 0, awaitingAfter: 0 },
  siteKnown: true,
};

const questions: ProofQuestion[] = [
  {
    id: 'q-open',
    question: 'Did they finish the valley?',
    answer: null,
    grounded_on: [],
    created_at: '2026-09-05T16:00:00Z',
  },
];

describe('JobFileTodayStrip', () => {
  it('shows a compact today strip when the file changed', () => {
    render(
      <JobFileTodayStrip
        jobId="job-1038"
        record={record}
        proofs={proofs}
        questions={questions}
        now={now}
      />,
    );

    const strip = screen.getByTestId('job-file-today');
    expect(strip).toHaveTextContent('What changed today');
    expect(strip).toHaveTextContent('1 new clip');
    expect(strip).toHaveTextContent('1 new scope line');
    expect(strip).toHaveTextContent('1 unanswered Ask');
    expect(strip.querySelectorAll('section').length).toBe(0);
  });

  it('stays off the page when nothing landed today', () => {
    render(
      <JobFileTodayStrip
        jobId="job-1038"
        record={{ ...record, scope: [] }}
        proofs={{ ...proofs, videos: [] }}
        questions={[]}
        now={now}
      />,
    );

    expect(screen.queryByTestId('job-file-today')).not.toBeInTheDocument();
    expect(screen.queryByText('What changed today')).not.toBeInTheDocument();
  });
});
