import { useEffect } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AskSeekTarget } from '../lib/askSeek';
import { VideoSeekProvider, useVideoSeek } from '../lib/videoSeek';
import { JobFileFocusProvider, useJobFileFocus } from '../lib/jobFileFocus';
import type { ProofResponse, SharedJobRecord } from '../lib/api';

const sharedJob = vi.fn();
const jobProofs = vi.fn();
const proofQuestions = vi.fn();
const askAboutProofs = vi.fn();

const askAboutProofsStream = vi.fn();
const askThreads = vi.fn();
const createAskThread = vi.fn();

vi.mock('../lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    sharedJob: (...args: unknown[]) => sharedJob(...args),
    jobProofs: (...args: unknown[]) => jobProofs(...args),
    proofQuestions: (...args: unknown[]) => proofQuestions(...args),
    askAboutProofs: (...args: unknown[]) => askAboutProofs(...args),
    askAboutProofsStream: (...args: unknown[]) => askAboutProofsStream(...args),
    askThreads: (...args: unknown[]) => askThreads(...args),
    createAskThread: (...args: unknown[]) => createAskThread(...args),
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
        { atSeconds: 39, text: 'Slope stripped; underlayment laid to the ridge' },
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
    askAboutProofsStream.mockReset();
    askThreads.mockReset();
    createAskThread.mockReset();
    askAboutProofsStream.mockRejectedValue(new Error('no stream in unit test'));
    askThreads.mockResolvedValue({
      threads: [{ id: 'thr-1', title: 'New chat', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', lastMessageAt: null }],
      project: { kind: 'job', jobId: 'job-1038' },
    });
    createAskThread.mockResolvedValue({
      thread: { id: 'thr-new', title: 'New chat', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', lastMessageAt: null },
    });
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
    render(
      <JobFileFocusProvider>
        <JobAskPanel jobId="job-1038" />
      </JobFileFocusProvider>,
    );

    expect(await screen.findByTestId('job-ask-panel')).toBeInTheDocument();
    expect(screen.getByTestId('job-ask-panel')).toHaveAttribute('aria-label', 'Ask this job');
    expect(screen.queryByRole('heading', { name: 'Ask this job' })).not.toBeInTheDocument();
    await user.click(
      await screen.findByRole('button', {
        name: 'What did the homeowner say about the skylights?',
      }),
    );

    await waitFor(() => {
      expect(askAboutProofs).toHaveBeenCalledWith(
        'job-1038',
        'What did the homeowner say about the skylights?',
        { threadId: 'thr-1' },
      );
    });
    expect(
      await screen.findByText('Yes. The homeowner asked that the skylights be left alone.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('From this job file')).toBeInTheDocument();
    expect(screen.queryByText(/Live model/)).not.toBeInTheDocument();
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
      <JobFileFocusProvider>
        <JobAskPanel
          jobId="job-1038"
          file={{ record, proofs }}
          ask={ask}
          loadQuestions={async () => ({ questions: [] })}
        />
      </JobFileFocusProvider>,
    );

    await user.click(
      await screen.findByRole('button', {
        name: 'What did the homeowner say about the skylights?',
      }),
    );

    await waitFor(() => {
      expect(ask).toHaveBeenCalledWith('What did the homeowner say about the skylights?', {
        threadId: null,
      });
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
      <JobFileFocusProvider><VideoSeekProvider>
        <SeekProbe onSeek={(target) => seeks.push(target)} />
        <JobAskPanel jobId="job-1038" file={{ record, proofs }} />
      </VideoSeekProvider></JobFileFocusProvider>,
    );

    await user.click(await screen.findByRole('button', { name: 'What happened with the tarp?' }));
    expect(await screen.findByText(/the tarp came off/i)).toBeInTheDocument();
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

  it('seeks the cited second on click, not only the first clock in the answer', async () => {
    proofQuestions.mockResolvedValue({
      questions: [
        {
          id: 'q-two',
          question: 'What happened with the tarp?',
          answer:
            'Yes. At 0:18, the tarp came off. Underlayment is down across two thirds of the slope by 0:39.',
          grounded_on: ['2026-08-05:after'],
          created_at: '2026-08-06T12:00:00Z',
        },
      ],
    });
    const seeks: AskSeekTarget[] = [];
    const user = userEvent.setup();
    render(
      <JobFileFocusProvider><VideoSeekProvider>
        <SeekProbe onSeek={(target) => seeks.push(target)} />
        <JobAskPanel jobId="job-1038" file={{ record, proofs }} />
      </VideoSeekProvider></JobFileFocusProvider>,
    );

    const cites = await screen.findAllByTestId('ask-cite');
    const late = cites.find((cite) => cite.getAttribute('data-at') === '39');
    expect(late).toBeTruthy();
    await user.click(late!);
    await waitFor(() => {
      expect(seeks.some((target) => target.atSeconds === 39 && target.proofId === 'p1')).toBe(true);
    });
  });

  it('does not auto-seek when an existing Ask thread is loaded', async () => {
    proofQuestions.mockResolvedValue({
      questions: [
        {
          id: 'q-history',
          question: 'What happened with the tarp?',
          answer: 'Yes. At 0:18, the tarp came off. That was 18 seconds into the recording.',
          grounded_on: ['2026-08-05:after'],
          created_at: '2026-08-06T12:00:00Z',
        },
      ],
    });
    const seeks: AskSeekTarget[] = [];
    render(
      <JobFileFocusProvider><VideoSeekProvider>
        <SeekProbe onSeek={(target) => seeks.push(target)} />
        <JobAskPanel jobId="job-1038" file={{ record, proofs }} />
      </VideoSeekProvider></JobFileFocusProvider>,
    );

    expect(await screen.findByText(/the tarp came off/i)).toBeInTheDocument();
    expect(screen.getAllByTestId('ask-cite').length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(proofQuestions).toHaveBeenCalled();
    });
    expect(seeks).toEqual([]);
  });

  it('does not artificially hold Ask after the reply lands', async () => {
    expect(ASK_MIN_TYPING_MS).toBe(0);
    const started = Date.now();
    await waitOutAskHold(started, ASK_MIN_TYPING_MS);
    expect(Date.now() - started).toBeLessThan(50);
  });

  it('streams tokens into the thread when the stream API is available', async () => {
    askAboutProofsStream.mockImplementation(
      async (
        _jobId: string,
        _q: string,
        handlers: { onToken?: (t: string) => void },
      ) => {
        handlers.onToken?.('Yes. ');
        handlers.onToken?.('The tarp came off.');
        return {
          answer: 'Yes. The tarp came off.',
          groundedOn: 1,
          model: 'gemini-2.5-flash-lite',
          question: {
            id: 'q-stream',
            question: 'Was the tarp removed?',
            answer: 'Yes. The tarp came off.',
            grounded_on: ['2026-08-05:after'],
            created_at: '2026-08-06T12:00:00Z',
          },
        };
      },
    );
    const user = userEvent.setup();
    render(
      <JobFileFocusProvider><VideoSeekProvider>
        <JobAskPanel jobId="job-1038" file={{ record, proofs }} />
      </VideoSeekProvider></JobFileFocusProvider>,
    );
    const box = await screen.findByPlaceholderText(/ask what you forgot/i);
    await user.type(box, 'Was the tarp removed?');
    await user.click(screen.getByRole('button', { name: /ask this job/i }));
    expect(await screen.findByText(/the tarp came off/i)).toBeInTheDocument();
    expect(askAboutProofsStream).toHaveBeenCalled();
    expect(askAboutProofs).not.toHaveBeenCalled();
  });

  it('renders source chips instead of Source parentheticals and focuses the job file', async () => {
    askAboutProofs.mockResolvedValue({
      answer:
        'Do not touch the skylights.\n\n(Source: Field Capture / Brief note / Scope).',
      groundedOn: 2,
      model: 'gemini-3.6-flash',
      question: {
        id: 'q-src',
        question: 'Any do-nots?',
        answer:
          'Do not touch the skylights.\n\n(Source: Field Capture / Brief note / Scope).',
        grounded_on: ['scope'],
        created_at: '2026-08-06T12:00:00Z',
      },
    });
    const user = userEvent.setup();
    const focused: string[] = [];
    function FocusProbe() {
      const { request } = useJobFileFocus();
      useEffect(() => {
        if (request) focused.push(request.section);
      }, [request]);
      return null;
    }
    render(
      <JobFileFocusProvider>
        <FocusProbe />
        <VideoSeekProvider>
          <JobAskPanel jobId="job-1038" file={{ record, proofs }} />
        </VideoSeekProvider>
      </JobFileFocusProvider>,
    );
    const box = await screen.findByPlaceholderText(/ask what you forgot/i);
    await user.type(box, 'Any do-nots?');
    await user.click(screen.getByRole('button', { name: /ask this job/i }));

    expect(await screen.findByText(/skylights/i)).toBeInTheDocument();
    expect(screen.queryByText(/\(Source:/i)).not.toBeInTheDocument();
    const chips = await screen.findAllByTestId('ask-source-chip');
    expect(chips.map((el) => el.textContent)).toEqual([
      'Who has access',
      'Brief note',
      'Scope',
    ]);
    await user.click(screen.getByRole('button', { name: 'Scope' }));
    await waitFor(() => {
      expect(focused).toContain('scope');
    });
  });

});
