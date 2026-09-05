import { useEffect } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AskSeekTarget } from '../lib/askSeek';
import { VideoSeekProvider, useVideoSeek } from '../lib/videoSeek';
import type { ProofResponse, SharedJobRecord } from '../lib/api';

const sharedJob = vi.fn();
const jobProofs = vi.fn();
const proofQuestions = vi.fn();
const askAboutProofs = vi.fn();

vi.mock('../lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    sharedJob: (...args: unknown[]) => sharedJob(...args),
    jobProofs: (...args: unknown[]) => jobProofs(...args),
    proofQuestions: (...args: unknown[]) => proofQuestions(...args),
    askAboutProofs: (...args: unknown[]) => askAboutProofs(...args),
  },
}));

import { ASK_MIN_TYPING_MS, JobAskPanel, waitOutAskHold } from './JobAskPanel';

const record: SharedJobRecord = {
  job: {
    id: 'job-1038',
    jobNumber: 1038,
    title: 'Cedar Ridge — storm damage',
    status: 'in_progress',
    claimNumber: 'CLM-1',
  },
  brief: {
    id: 'b1',
    revision: 1,
    facts: { 'Site address': '1408 Meridian Ave' },
    note: null,
  },
  revisions: [],
  currentRevision: 1,
  parties: [],
  scope: [],
  money: { approved: 0, pending: 0, unpricedApprovals: 0 },
  messages: [
    {
      id: 'm1',
      party_id: null,
      author_label: 'Homeowner',
      body: 'Please do not touch the skylights.',
      scope_item_id: null,
      is_decision: false,
      created_at: '2026-08-04T10:00:00Z',
    },
  ],
  risks: [],
};

const proofs: ProofResponse = {
  days: [],
  videos: [
    {
      id: 'p1',
      partyId: 'pty-1',
      company: 'Delgado Roofing',
      workDate: '2026-08-05',
      phase: 'after',
      durationSeconds: 143,
      analysisStatus: 'done',
      narrationStatus: 'done',
      transcriptStatus: 'done',
      transcriptError: null,
      aiSummary: 'The tarp is gone from the north slope.',
      heardOnMic: 'Homeowner asked us not to touch the skylights.',
      events: [
        { atSeconds: 8, text: 'Camera finds the north slope' },
        { atSeconds: 18, text: 'Tarp pulled from the ridge' },
      ],
    },
  ],
  counts: { days: 0, videos: 1, payable: 0, contradicted: 0, awaitingAfter: 0 },
  siteKnown: true,
};

describe('JobAskPanel', () => {
  beforeEach(() => {
    sharedJob.mockReset();
    jobProofs.mockReset();
    proofQuestions.mockReset();
    askAboutProofs.mockReset();
    sharedJob.mockResolvedValue(record);
    jobProofs.mockResolvedValue(proofs);
    proofQuestions.mockResolvedValue({ questions: [] });
    askAboutProofs.mockResolvedValue({
      answer: 'Yes. The homeowner asked that the skylights be left alone.',
      groundedOn: 1,
      model: 'gemini-3.6-flash',
      question: {
        id: 'q1',
        question: 'What did the homeowner say about the skylights?',
        answer: 'Yes. The homeowner asked that the skylights be left alone.',
        grounded_on: ['2026-08-05:after'],
        created_at: '2026-08-06T12:00:00Z',
      },
    });
  });

  function SeekProbe({ onSeek }: { onSeek: (target: AskSeekTarget) => void }) {
    const { request } = useVideoSeek();
    useEffect(() => {
      if (request) onSeek(request);
    }, [onSeek, request]);
    return null;
  }

  it('asks from inside the job profile', async () => {
    const user = userEvent.setup();
    render(<JobAskPanel jobId="job-1038" />);

    expect(await screen.findByRole('heading', { name: 'Ask this job' })).toBeInTheDocument();
    await user.click(
      await screen.findByRole('button', {
        name: 'What did the homeowner say about the skylights?',
      }),
    );

    await waitFor(() => {
      expect(askAboutProofs).toHaveBeenCalledWith(
        'job-1038',
        'What did the homeowner say about the skylights?',
      );
    });
    expect(
      await screen.findByText('Yes. The homeowner asked that the skylights be left alone.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Live model · gemini-3.6-flash')).toBeInTheDocument();
  });

  it('asks through a guest share instead of the office session', async () => {
    const ask = vi.fn().mockResolvedValue({
      answer: 'From the guest file.',
      groundedOn: 1,
      question: {
        id: 'q-guest',
        question: 'What did the homeowner say about the skylights?',
        answer: 'From the guest file.',
        grounded_on: ['brief'],
        created_at: '2026-08-06T12:00:00Z',
      },
    });
    const user = userEvent.setup();
    render(
      <JobAskPanel
        jobId="job-1038"
        file={{ record, proofs }}
        ask={ask}
        loadQuestions={async () => ({ questions: [] })}
      />,
    );

    await user.click(
      await screen.findByRole('button', {
        name: 'What did the homeowner say about the skylights?',
      }),
    );

    await waitFor(() => {
      expect(ask).toHaveBeenCalledWith('What did the homeowner say about the skylights?');
    });
    expect(askAboutProofs).not.toHaveBeenCalled();
    expect(await screen.findByText('From the guest file.')).toBeInTheDocument();
    expect(await screen.findByText('From this job file')).toBeInTheDocument();
    expect(screen.queryByText(/Live model/)).not.toBeInTheDocument();
  });

  it('seeks the player to the Analysis second when an answer cites a moment', async () => {
    askAboutProofs.mockResolvedValue({
      answer: 'Yes. At 0:18, the tarp came off. That was 18 seconds into the recording.',
      groundedOn: 1,
      model: 'gemini-3.6-flash',
      question: {
        id: 'q-tarp',
        question: 'What happened with the tarp?',
        answer: 'Yes. At 0:18, the tarp came off. That was 18 seconds into the recording.',
        grounded_on: ['2026-08-05:after'],
        created_at: '2026-08-06T12:00:00Z',
      },
    });
    const seeks: AskSeekTarget[] = [];
    const user = userEvent.setup();
    render(
      <VideoSeekProvider>
        <SeekProbe onSeek={(target) => seeks.push(target)} />
        <JobAskPanel jobId="job-1038" file={{ record, proofs }} />
      </VideoSeekProvider>,
    );

    await user.click(await screen.findByRole('button', { name: 'What happened with the tarp?' }));
    expect(
      await screen.findByText(/the tarp came off/i),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(seeks.some((target) => target.atSeconds === 18 && target.proofId === 'p1')).toBe(true);
    });

    const cite = screen.getAllByTestId('ask-cite')[0];
    expect(cite).toHaveAttribute('data-at', '18');
    await user.click(cite);
    await waitFor(() => {
      expect(seeks.filter((target) => target.atSeconds === 18).length).toBeGreaterThan(1);
    });
  });

  it('holds the typing indicator for 10× a short reply', async () => {
    vi.useFakeTimers();
    try {
      const started = Date.now();
      const pending = waitOutAskHold(started, ASK_MIN_TYPING_MS);
      await vi.advanceTimersByTimeAsync(ASK_MIN_TYPING_MS - 1);
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
