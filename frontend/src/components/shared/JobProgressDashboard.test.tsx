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

describe('JobProgressDashboard', () => {
  beforeEach(() => {
    jobProofs.mockReset();
  });

  it('shows Needs attention / Now / Done / Left — no status prose or progress meter', async () => {
    render(
      <JobProgressDashboard
        jobId="job-1"
        record={record}
        initialProof={proof}
        showProofOfWork={false}
      />,
    );

    expect(screen.queryByTestId('job-progress-up-to-speed')).not.toBeInTheDocument();
    expect(screen.queryByText(/Worth a look/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Needs your attention:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Crews finished/i)).not.toBeInTheDocument();

    expect(screen.queryByTestId('job-progress-meter')).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ of \d+ done/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^\d+%$/)).not.toBeInTheDocument();

    expect(await screen.findByRole('heading', { name: 'Needs attention' })).toBeInTheDocument();
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

    expect(screen.getByRole('heading', { name: 'Cedar Ridge rebuild' })).toBeInTheDocument();
    expect(screen.queryByText(/#1038/)).not.toBeInTheDocument();
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

    expect(await screen.findByRole('heading', { name: 'Now' })).toBeInTheDocument();
    expect(screen.queryByTestId('job-progress-meter')).not.toBeInTheDocument();
    expect(screen.queryByTestId('job-progress-up-to-speed')).not.toBeInTheDocument();
    expect(screen.queryByText(/Crews finished/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Needs attention' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('job-progress-needs-attention')).not.toBeInTheDocument();
  });

  it('shows a plain-English live story from clip Glance/Scan and hides private moments', async () => {
    const withVideos = {
      ...proof,
      videos: [
        {
          id: 'vid-1',
          partyId: 'pty-2',
          company: 'Delgado Roofing',
          workDate: '2026-08-05',
          phase: 'after',
          durationSeconds: 90,
          analysisStatus: 'done',
          narrationStatus: null,
          transcriptStatus: null,
          transcriptError: null,
          aiSummary: null,
          heardOnMic: null,
          conversation: {
            conversationExecutiveSummary: 'Crew finished the north slope tear-off.',
            conversationKeyMoments: [{ tSec: 10, label: 'Decision', text: 'Agreed to tarp overnight' }],
          },
          people: {
            peoplePresent: [
              { id: '1', label: 'Alex', role: 'crew', appearance: null, appearMoments: [] },
            ],
          },
          privacyRedactions: null,
        },
        {
          id: 'vid-private',
          partyId: 'pty-2',
          company: 'Delgado Roofing',
          workDate: '2026-08-06',
          phase: 'after',
          durationSeconds: 40,
          analysisStatus: 'done',
          narrationStatus: null,
          transcriptStatus: null,
          transcriptError: null,
          aiSummary: 'Worker walked into the bathroom while recording',
          heardOnMic: null,
          conversation: {
            conversationSummary: 'Discussion in the bathroom',
          },
          people: null,
          privacyRedactions: {
            version: 1,
            ranges: [
              { startSec: 5, endSec: 30, reason: 'bathroom', confidence: 0.9, source: 'vision' },
            ],
          },
        },
      ],
    };

    render(
      <JobProgressDashboard
        jobId="job-1"
        record={{ ...record, risks: [] }}
        initialProof={withVideos}
        showProofOfWork={false}
      />,
    );

    const live = await screen.findByTestId('homeowner-live-progress-story');
    expect(live).toHaveTextContent(/What happened/);
    expect(live).toHaveTextContent(/north slope/i);
    expect(live.textContent).not.toMatch(/bathroom/i);
    expect(screen.getByTestId('live-story-timeline')).toBeInTheDocument();
  });


  it('frames Happening Now with title, hint, and row brief when framed', async () => {
    render(
      <JobProgressDashboard
        jobId="job-1"
        record={{ ...record, risks: [] }}
        initialProof={proof}
        showProofOfWork={false}
        showIdentity={false}
        showLiveStory={false}
        framed
      />,
    );

    expect(await screen.findByTestId('job-happening-now')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Happening Now' })).toBeInTheDocument();
    expect(
      screen.getByText("What's on site right now, what's done, and what's left."),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Now' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Done' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Left' })).toBeInTheDocument();
    expect(screen.queryByTestId('homeowner-live-progress-story')).not.toBeInTheDocument();
  });

});
