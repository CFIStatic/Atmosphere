import { useEffect } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
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
const answerSpeakerVerification = vi.fn();
const rateAskAnswer = vi.fn();
const askFeedback = vi.fn();
const askPins = vi.fn();
const pinAskAnswer = vi.fn();
const unpinAskAnswer = vi.fn();
const searchAskChats = vi.fn();
const askApproval = vi.fn();
const approveAskApproval = vi.fn();
const denyAskApproval = vi.fn();

vi.mock('../lib/api', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    code?: string;
    constructor(status = 0, message = '', code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
  api: {
    sharedJob: (...args: unknown[]) => sharedJob(...args),
    jobProofs: (...args: unknown[]) => jobProofs(...args),
    proofQuestions: (...args: unknown[]) => proofQuestions(...args),
    askAboutProofs: (...args: unknown[]) => askAboutProofs(...args),
    askAboutProofsStream: (...args: unknown[]) => askAboutProofsStream(...args),
    askThreads: (...args: unknown[]) => askThreads(...args),
    createAskThread: (...args: unknown[]) => createAskThread(...args),
    answerSpeakerVerification: (...args: unknown[]) => answerSpeakerVerification(...args),
    rateAskAnswer: (...args: unknown[]) => rateAskAnswer(...args),
    askFeedback: (...args: unknown[]) => askFeedback(...args),
    askPins: (...args: unknown[]) => askPins(...args),
    pinAskAnswer: (...args: unknown[]) => pinAskAnswer(...args),
    unpinAskAnswer: (...args: unknown[]) => unpinAskAnswer(...args),
    searchAskChats: (...args: unknown[]) => searchAskChats(...args),
    askApproval: (...args: unknown[]) => askApproval(...args),
    approveAskApproval: (...args: unknown[]) => approveAskApproval(...args),
    denyAskApproval: (...args: unknown[]) => denyAskApproval(...args),
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

async function openAskStepsSources(user: Awaited<ReturnType<typeof userEvent.setup>>) {
  const toggles = await screen.findAllByTestId('ask-steps-sources-toggle');
  await user.click(toggles[0]!);
}

describe('JobAskPanel', () => {
  beforeEach(() => {
    sharedJob.mockReset();
    jobProofs.mockReset();
    proofQuestions.mockReset();
    askAboutProofs.mockReset();
    askAboutProofsStream.mockReset();
    askThreads.mockReset();
    createAskThread.mockReset();
    answerSpeakerVerification.mockReset();
    for (const fn of [rateAskAnswer, askFeedback, askPins, pinAskAnswer, unpinAskAnswer, searchAskChats, askApproval, approveAskApproval, denyAskApproval]) fn.mockReset();
    rateAskAnswer.mockResolvedValue({ feedback: null });
    askFeedback.mockResolvedValue({ feedback: {} });
    askPins.mockResolvedValue({ pins: [] });
    searchAskChats.mockResolvedValue({ results: [] });
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
        question: 'What was said about the skylights?',
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
        name: 'What was said about the skylights?',
      }),
    );

    await waitFor(() => {
      expect(askAboutProofs).toHaveBeenCalledWith(
        'job-1038',
        'What was said about the skylights?',
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
        question: 'What was said about the skylights?',
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
        name: 'What was said about the skylights?',
      }),
    );

    await waitFor(() => {
      expect(ask).toHaveBeenCalledWith('What was said about the skylights?', {
        threadId: null,
      });
    });
    expect(askAboutProofs).not.toHaveBeenCalled();
    expect(await screen.findByText('From the guest file.')).toBeInTheDocument();
    expect(await screen.findByText('From this job file')).toBeInTheDocument();
    expect(screen.queryByText(/Live model/)).not.toBeInTheDocument();
  });

  it('a Computer task reply has no "From this job file" line', async () => {
    const answer =
      "Opening a browser now, and I'll check with you before anything is submitted.\n\n⟦actions: start_computer_task|Started a browser task.|computer|computer-task:11111111-2222-4333-8444-555555555555⟧";
    const ask = vi.fn().mockResolvedValue({
      answer,
      groundedOn: 3,
      question: {
        id: 'q-computer',
        question: 'Fill in the form at https://httpbin.org/forms/post',
        answer,
        grounded_on: ['brief'],
        created_at: '2026-10-04T12:00:00Z',
      },
    });
    const user = userEvent.setup();
    render(
      <JobFileFocusProvider>
        <JobAskPanel jobId="job-1038" file={{ record, proofs }} ask={ask} loadQuestions={async () => ({ questions: [] })} />
      </JobFileFocusProvider>,
    );
    await user.click(await screen.findByRole('button', { name: 'What was said about the skylights?' }));
    expect(await screen.findByText(/Opening a browser now/)).toBeInTheDocument();
    expect(await screen.findByTestId('computer-task-card')).toBeInTheDocument();
    expect(screen.queryByText('From this job file')).not.toBeInTheDocument();
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

  it('streams the checked preview, drops it on reset, and swaps in the final answer', async () => {
    let releaseFirst: () => void = () => {};
    let releaseSecond: () => void = () => {};
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const second = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    askAboutProofsStream.mockImplementation(
      async (
        _jobId: string,
        _q: string,
        handlers: { onToken?: (t: string) => void; onReset?: () => void; onStatus?: (phase: string) => void },
      ) => {
        handlers.onStatus?.('Searching transcripts');
        await first;
        handlers.onToken?.("I'll look that up. ");
        await second;
        handlers.onReset?.();
        handlers.onToken?.('The tarp came off. ');
        return {
          answer: 'The tarp came off on Aug 5.',
          groundedOn: 1,
          model: 'claude-opus',
          question: null,
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
    const pending = user.click(screen.getByRole('button', { name: /ask this job/i }));
    const thinking = await screen.findByTestId('ask-status');
    expect(thinking).toHaveTextContent('Thinking');
    expect(thinking.querySelector('.gpt-typing')).not.toBeNull();
    // Internal phase names are not shown; only web / Computer / writing phases are.
    expect(screen.queryByText('Searching transcripts')).not.toBeInTheDocument();
    releaseFirst();
    expect(await screen.findByTestId('ask-live-preview')).toHaveTextContent("I'll look that up.");
    expect(screen.queryByTestId('ask-message-copy')).not.toBeInTheDocument();
    releaseSecond();
    await pending;
    expect(await screen.findByText(/the tarp came off on aug 5/i)).toBeInTheDocument();
    expect(screen.queryByTestId('ask-live-preview')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ask-status')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('ask-answer-body')).toHaveLength(1);
    expect(screen.getByTestId('ask-message-copy')).toBeInTheDocument();
    expect(screen.queryByText(/I'll look that up/)).not.toBeInTheDocument();
  });

  it('says it is searching the web while a web answer is on the way', async () => {
    let release: () => void = () => {};
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    askAboutProofsStream.mockImplementation(
      async (_jobId: string, _q: string, handlers: { onStatus?: (phase: string) => void }) => {
        handlers.onStatus?.('Searching the web…');
        await paused;
        return {
          answer: 'The Yankees are favored tonight.',
          groundedOn: 0,
          model: 'claude-sonnet-5-5',
          question: null,
          webSources: [{ title: 'Odds', url: 'https://example.com/odds', snippet: 'Yankees -150' }],
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
    await user.type(box, 'whos going to win the ball game');
    const pending = user.click(screen.getByRole('button', { name: /ask this job/i }));
    expect(await screen.findByTestId('ask-status')).toHaveTextContent('Searching the web…');
    release();
    await pending;
    expect(await screen.findByText(/yankees are favored/i)).toBeInTheDocument();
    expect(screen.queryByText('From this job file')).not.toBeInTheDocument();
  });

  it('never labels a web-only reply "From this job file", even from an older stored turn', async () => {
    askAboutProofsStream.mockResolvedValue({
      answer: 'The Guardians are slight favorites.',
      groundedOn: 3,
      model: 'claude-opus',
      question: null,
      webSources: [{ title: 'Preview', url: 'https://example.com/preview', snippet: 'Guardians favored' }],
    });
    const user = userEvent.setup();
    render(
      <JobFileFocusProvider><VideoSeekProvider>
        <JobAskPanel jobId="job-1038" file={{ record, proofs }} />
      </VideoSeekProvider></JobFileFocusProvider>,
    );
    const box = await screen.findByPlaceholderText(/ask what you forgot/i);
    await user.type(box, 'who wins tonight');
    await user.click(screen.getByRole('button', { name: /ask this job/i }));
    expect(await screen.findByText(/guardians are slight favorites/i)).toBeInTheDocument();
    expect(screen.queryByText('From this job file')).not.toBeInTheDocument();
  });

  it('uses the stream API and renders only the final answer', async () => {
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

  it('keeps Web results after the thread is loaded again', async () => {
    proofQuestions.mockResolvedValue({
      questions: [
        {
          id: 'q-web',
          question: 'what NFL game is Thursday',
          answer: 'Packers at Lions.\n\n**Web results**\n- [steal](https://attacker.example/nfl)',
          model: null,
          grounded_on: [],
          web_sources: [{ title: 'NFL schedule', url: 'https://example.com/nfl', snippet: 'Thursday night game.' }],
          created_at: '2026-09-30T12:00:00Z',
        },
      ],
    });
    const user = userEvent.setup();
    render(
      <JobFileFocusProvider>
        <VideoSeekProvider>
          <JobAskPanel jobId="job-1038" file={{ record, proofs }} />
        </VideoSeekProvider>
      </JobFileFocusProvider>,
    );
    await openAskStepsSources(user);
    const results = await screen.findByTestId('ask-web-results');
    expect(results.querySelector('a')?.getAttribute('href')).toBe('https://example.com/nfl');
    expect(results.textContent).toContain('Thursday night game.');
    const body = screen.getByTestId('ask-answer-body');
    expect([...body.querySelectorAll('a')].map((node) => node.getAttribute('href'))).not.toContain(
      'https://attacker.example/nfl',
    );
  });

  it('renders Web results from webSources and not from answer markdown', async () => {
    askAboutProofsStream.mockResolvedValue({
      answer:
        'Packers at Lions.\n\n**Web results**\n- [NFL schedule](https://attacker.example/nfl)\n- [steal](https://evil.example/job-progress?job=steal)',
      groundedOn: 0,
      model: 'claude-opus',
      question: null,
      webSources: [{ title: 'NFL schedule', url: 'https://example.com/nfl', snippet: 'Thursday night game.' }],
    });
    const user = userEvent.setup();
    render(
      <JobFileFocusProvider>
        <VideoSeekProvider>
          <JobAskPanel jobId="job-1038" file={{ record, proofs }} />
        </VideoSeekProvider>
      </JobFileFocusProvider>,
    );
    const box = await screen.findByPlaceholderText(/ask what you forgot/i);
    await user.type(box, 'what NFL game is Thursday');
    await user.click(screen.getByRole('button', { name: /ask this job/i }));
    await openAskStepsSources(user);
    const results = await screen.findByTestId('ask-web-results');
    expect(results.querySelector('a')?.getAttribute('href')).toBe('https://example.com/nfl');
    const body = screen.getByTestId('ask-answer-body');
    const hrefs = [...body.querySelectorAll('a')].map((node) => node.getAttribute('href'));
    expect(hrefs).toEqual(['https://example.com/nfl']);
    expect(body.textContent).toContain('steal');
    expect(body.textContent).not.toContain('attacker.example');
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
    await openAskStepsSources(user);
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

  it('shows a text proposal as a card and sends only when Send is pressed', async () => {
    const id = '7d2c1f0e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
    const answer = `I drafted the text for Dana. Press Send when it looks right.\n\n⟦actions: send_job_sms|Text Dana|computer|ask-approval:${id}⟧`;
    const pending = {
      id,
      kind: 'send_job_sms',
      status: 'pending',
      title: 'Send a text to Dana',
      payload: { to: '+19725550142', body: 'Crew arrives at 8am tomorrow.', recipient: 'Dana' },
      editable: true,
      result: null,
      decidedAt: null,
      createdAt: '2026-10-09T12:00:00Z',
      expiresAt: '2026-10-10T12:00:00Z',
    };
    askApproval.mockResolvedValue({ approval: pending });
    approveAskApproval.mockResolvedValue({
      approval: { ...pending, status: 'approved', result: 'Text sent to Dana.', decidedAt: '2026-10-09T12:01:00Z' },
    });
    askAboutProofsStream.mockImplementation(
      async (_jobId: string, question: string, handlers: { onToken?: (t: string) => void; onStatus?: (phase: string) => void }) => {
        handlers.onStatus?.('Drafting the text…');
        handlers.onToken?.('I drafted the text for Dana.');
        return {
          answer,
          groundedOn: 0,
          model: 'claude-opus',
          question: { id: 'q-sms', question, answer, grounded_on: [], created_at: '2026-10-09T12:00:00Z' },
        };
      },
    );
    const user = userEvent.setup();
    render(
      <JobFileFocusProvider>
        <VideoSeekProvider>
          <JobAskPanel jobId="job-1038" file={{ record, proofs }} />
        </VideoSeekProvider>
      </JobFileFocusProvider>,
    );
    await user.type(await screen.findByPlaceholderText(/ask what you forgot/i), 'Text Dana that we arrive at 8');
    await user.click(screen.getByRole('button', { name: /ask this job/i }));
    const card = await screen.findByTestId('ask-approval-card');
    expect(card).toHaveTextContent(/Send a text to Dana/);
    expect(card).toHaveTextContent(/Crew arrives at 8am tomorrow/);
    expect(screen.queryByTestId('computer-task-card')).toBeNull();
    expect(approveAskApproval).not.toHaveBeenCalled();
    expect(screen.getByTestId('ask-work-summary')).toHaveTextContent(/Worked for \d+s/);
    await user.click(screen.getByTestId('ask-approval-approve'));
    const receipt = await screen.findByTestId('ask-approval-receipt');
    expect(receipt).toHaveAttribute('data-status', 'approved');
    expect(receipt).toHaveTextContent(/Text sent to Dana/);
    expect(approveAskApproval).toHaveBeenCalledWith('job-1038', id, null);
  });

  it('ticks off live steps while working and folds them into a summary after', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    askAboutProofsStream.mockImplementation(
      async (_jobId: string, question: string, handlers: { onToken?: (t: string) => void; onStatus?: (phase: string) => void }) => {
        handlers.onStatus?.('Looking through clips…');
        handlers.onStatus?.('internal_phase_name');
        handlers.onStatus?.('Searching what was said…');
        await gate;
        handlers.onToken?.('The tarp came off.');
        return {
          answer: 'The tarp came off.',
          groundedOn: 1,
          model: 'claude-opus',
          question: { id: 'q-steps', question, answer: 'The tarp came off.', grounded_on: [], created_at: '2026-10-09T12:00:00Z' },
        };
      },
    );
    const user = userEvent.setup();
    render(
      <JobFileFocusProvider>
        <VideoSeekProvider>
          <JobAskPanel jobId="job-1038" file={{ record, proofs }} />
        </VideoSeekProvider>
      </JobFileFocusProvider>,
    );
    await user.type(await screen.findByPlaceholderText(/ask what you forgot/i), 'What happened to the tarp?');
    await user.click(screen.getByRole('button', { name: /ask this job/i }));
    const live = await screen.findByTestId('ask-live-steps');
    const items = live.querySelectorAll('li');
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toMatch(/Looking through clips/);
    expect(items[1]!.textContent).toMatch(/Searching what was said…/);
    expect(live.textContent).not.toMatch(/internal_phase_name/);
    release();
    expect(await screen.findByTestId('ask-answer-body')).toHaveTextContent(/tarp came off/i);
    await waitFor(() => expect(screen.queryByTestId('ask-live-steps')).toBeNull());
    const summary = screen.getByTestId('ask-work-summary');
    expect(summary).toHaveTextContent(/Worked for \d+s · 2 steps/);
    await user.click(within(summary).getByRole('button'));
    expect(summary).toHaveTextContent(/Searching what was said/);
  });

  it('streams text, seeks a moment chip, and asks a follow-up', async () => {
    const job = 'job-1038';
    const proof = 'proof-tarp';
    const cite = `video/${job}/${proof}/north-slope@18`;
    const answer = `The tarp came off.\n\n⟦sources: ${cite}⟧\n⟦quotes: ${cite}|Homeowner|The tarp came off the north slope.⟧\n⟦followups: What was said about the skylights? ;; What does the job history say?⟧`;
    askAboutProofsStream.mockImplementation(
      async (_jobId: string, question: string, handlers: { onToken?: (t: string) => void; onStatus?: (phase: string) => void }) => {
        if (/skylights/i.test(question)) {
          handlers.onToken?.('The file does not mention skylights.');
          return {
            answer: 'The file does not mention skylights.',
            groundedOn: 0,
            model: 'claude-opus',
            question: null,
          };
        }
        handlers.onStatus?.('Searching transcripts');
        handlers.onToken?.('The tarp ');
        handlers.onToken?.('came off.');
        return {
          answer,
          groundedOn: 1,
          model: 'claude-opus',
          question: {
            id: 'q-moment',
            question,
            answer,
            grounded_on: [proof],
            created_at: '2026-08-06T12:00:00Z',
          },
        };
      },
    );
    const seeks: AskSeekTarget[] = [];
    const user = userEvent.setup();
    render(
      <JobFileFocusProvider>
        <VideoSeekProvider>
          <SeekProbe onSeek={(target) => seeks.push(target)} />
          <JobAskPanel jobId={job} file={{ record, proofs }} />
        </VideoSeekProvider>
      </JobFileFocusProvider>,
    );
    const box = await screen.findByPlaceholderText(/ask what you forgot/i);
    await user.type(box, 'What happened to the tarp?');
    await user.click(screen.getByRole('button', { name: /ask this job/i }));
    expect(await screen.findByTestId('ask-answer-body')).toHaveTextContent(/the tarp came off/i);
    expect(screen.getByTestId('ask-quote').textContent).toMatch(/Unidentified speaker/);
    expect(screen.getByTestId('ask-quote').textContent).not.toMatch(/Homeowner|\(/);
    expect(screen.getByTestId('ask-quote').textContent).toMatch(/north slope/);
    await openAskStepsSources(user);
    const chip = await screen.findByTestId('ask-source-chip');
    expect(chip.textContent).toMatch(/0:18/);
    await user.click(chip);
    await waitFor(() => {
      expect(seeks.at(-1)).toMatchObject({ atSeconds: 18, proofId: proof });
    });
    await user.click(screen.getByRole('button', { name: /skylights/i }));
    expect(await screen.findByText(/does not mention skylights/i)).toBeInTheDocument();
  });

  it('renders a comparison table and copies the finished note', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    const note = '## Homeowner summary\n\n- **Sep 17 — Office.** A seated conversation.';
    const answer = `Three clips are on this file.\n\n⟦artifact⟧\n${note}\n⟦/artifact⟧\n\n| Visit | What the file shows |\n| --- | --- |\n| Sep 17 | Office |\n\n⟦sources: video/job-1038/proof-tarp/north-slope@18⟧`;
    askAboutProofsStream.mockResolvedValue({
      answer,
      groundedOn: 1,
      model: 'claude-opus',
      question: { id: 'q-note', question: 'write a summary', answer, grounded_on: ['proof-tarp'], created_at: '2026-08-06T12:00:00Z' },
    });
    const user = userEvent.setup();
    render(
      <JobFileFocusProvider>
        <JobAskPanel jobId="job-1038" file={{ record, proofs }} />
      </JobFileFocusProvider>,
    );
    const box = await screen.findByPlaceholderText(/ask what you forgot/i);
    await user.type(box, 'write a summary for the homeowner');
    await user.click(screen.getByRole('button', { name: /ask this job/i }));
    expect(await screen.findByRole('heading', { name: /homeowner summary/i })).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent('Sep 17');
    await user.click(screen.getByTestId('ask-copy'));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(note);
    });
    expect(screen.getByTestId('ask-copy')).toHaveTextContent('Copied');
  });

  it('shows looking through clips, then stop keeps the question', async () => {
    askAboutProofsStream.mockImplementation(
      (_jobId: string, _q: string, _handlers: unknown, opts?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          const signal = opts?.signal;
          if (signal?.aborted) {
            reject(new DOMException('Stopped', 'AbortError'));
            return;
          }
          signal?.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')));
        }),
    );
    const user = userEvent.setup();
    render(
      <JobFileFocusProvider>
        <VideoSeekProvider>
          <JobAskPanel jobId="job-1038" file={{ record, proofs }} />
        </VideoSeekProvider>
      </JobFileFocusProvider>,
    );
    const box = await screen.findByPlaceholderText(/ask what you forgot/i);
    await user.type(box, 'Was the tarp removed?');
    await user.click(screen.getByRole('button', { name: /ask this job/i }));
    expect(await screen.findByTestId('ask-status')).toHaveTextContent('Thinking');
    await user.click(screen.getByTestId('ask-stop'));
    expect(await screen.findByText('Was the tarp removed?')).toBeInTheDocument();
    expect(screen.queryByText(/could not answer/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ask this job/i })).toBeInTheDocument();
  });

  it('copies a message without the source trailer and regenerates it', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    const answer = 'The tarp came off.\n\n⟦sources: video/job-1038/proof-tarp/north-slope@18⟧';
    let n = 0;
    askAboutProofsStream.mockImplementation(async (_jobId: string, question: string, handlers: { onToken?: (t: string) => void }) => {
      n += 1;
      handlers.onToken?.('The tarp came off.');
      return {
        answer,
        groundedOn: 1,
        model: 'claude-opus',
        question: {
          id: `q-copy-${n}`,
          question,
          answer,
          grounded_on: ['proof-tarp'],
          created_at: '2026-08-06T12:00:00Z',
        },
      };
    });
    const user = userEvent.setup();
    render(
      <JobFileFocusProvider>
        <VideoSeekProvider>
          <JobAskPanel jobId="job-1038" file={{ record, proofs }} />
        </VideoSeekProvider>
      </JobFileFocusProvider>,
    );
    const box = await screen.findByPlaceholderText(/ask what you forgot/i);
    await user.type(box, 'Was the tarp removed?');
    await user.click(screen.getByRole('button', { name: /ask this job/i }));
    expect(await screen.findByText(/the tarp came off/i)).toBeInTheDocument();
    await user.click(screen.getByTestId('ask-message-copy'));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('The tarp came off.');
    });
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Regenerate' }));
    await waitFor(() => {
      expect(askAboutProofsStream).toHaveBeenCalledTimes(2);
    });
    expect(askAboutProofsStream.mock.calls[1]?.[1]).toBe('Was the tarp removed?');
  });

  it('replaces the dots with an error bubble and retries the same question', async () => {
    askAboutProofs.mockRejectedValueOnce(new Error('boom'));
    const user = userEvent.setup();
    render(
      <JobFileFocusProvider>
        <VideoSeekProvider>
          <JobAskPanel jobId="job-1038" file={{ record, proofs }} />
        </VideoSeekProvider>
      </JobFileFocusProvider>,
    );
    const box = await screen.findByPlaceholderText(/ask what you forgot/i);
    await user.type(box, 'Was the tarp removed?');
    await user.click(screen.getByRole('button', { name: /ask this job/i }));
    const failure = await screen.findByTestId('ask-error');
    expect(failure).toHaveTextContent(/could not answer that from the file/i);
    expect(screen.queryByTestId('ask-status')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ask-answer-body')).not.toBeInTheDocument();
    expect(screen.getByText('Was the tarp removed?')).toBeInTheDocument();
    await user.click(screen.getByTestId('ask-error-retry'));
    expect(await screen.findByText(/skylights be left alone/i)).toBeInTheDocument();
    expect(screen.queryByTestId('ask-error')).not.toBeInTheDocument();
    expect(screen.getAllByText('Was the tarp removed?')).toHaveLength(1);
    expect(askAboutProofs).toHaveBeenCalledTimes(2);
  });

  it('never leaves an empty assistant bubble when the answer is blank', async () => {
    askAboutProofsStream.mockResolvedValue({ answer: '   ', groundedOn: 0, model: null, question: null });
    const user = userEvent.setup();
    render(
      <JobFileFocusProvider>
        <VideoSeekProvider>
          <JobAskPanel jobId="job-1038" file={{ record, proofs }} />
        </VideoSeekProvider>
      </JobFileFocusProvider>,
    );
    const box = await screen.findByPlaceholderText(/ask what you forgot/i);
    await user.type(box, 'Was the tarp removed?');
    await user.click(screen.getByRole('button', { name: /ask this job/i }));
    expect(await screen.findByTestId('ask-error')).toHaveTextContent(/no answer came back/i);
    expect(screen.queryByTestId('ask-answer-body')).not.toBeInTheDocument();
  });

  it('a new question after a failure does not leave the failed one orphaned', async () => {
    askAboutProofs.mockRejectedValueOnce(new Error('boom'));
    const user = userEvent.setup();
    render(
      <JobFileFocusProvider>
        <VideoSeekProvider>
          <JobAskPanel jobId="job-1038" file={{ record, proofs }} />
        </VideoSeekProvider>
      </JobFileFocusProvider>,
    );
    const box = await screen.findByPlaceholderText(/ask what you forgot/i);
    await user.type(box, 'Was the tarp removed?');
    await user.click(screen.getByRole('button', { name: /ask this job/i }));
    expect(await screen.findByTestId('ask-error')).toBeInTheDocument();
    await user.type(box, 'Any do-nots?');
    await user.click(screen.getByRole('button', { name: /ask this job/i }));
    expect(await screen.findByText(/skylights be left alone/i)).toBeInTheDocument();
    expect(screen.queryByText('Was the tarp removed?')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ask-error')).not.toBeInTheDocument();
    expect(screen.getByText('Any do-nots?')).toBeInTheDocument();
  });

  it('replaces the queue with the server response so a later No still applies', async () => {
    const user = userEvent.setup();
    const marco = {
      id: 'v-marco',
      proofId: 'clip-north',
      question: 'Is Speaker 2 Marco? Heard at 0:42 in “North slope walkthrough”.',
      speakerLabel: 'Speaker 2',
      clipTitle: 'North slope walkthrough',
      tSec: 42,
      candidateName: 'Marco',
      role: null,
      quote: "I'm Marco",
    };
    const priya = {
      id: 'v-priya',
      proofId: 'clip-south',
      question: 'Is Speaker 4 in South wall at 1:10 Priya?',
      speakerLabel: 'Speaker 4',
      clipTitle: 'South wall',
      tSec: 70,
      candidateName: 'Priya',
      role: null,
      quote: 'Priya here',
    };
    answerSpeakerVerification
      .mockResolvedValueOnce({ verifications: [priya] })
      .mockResolvedValueOnce({ verifications: [] });
    render(
      <JobFileFocusProvider>
        <JobAskPanel jobId="job-1038" file={{ record, proofs }} initialVerifications={[marco, priya]} />
      </JobFileFocusProvider>,
    );
    expect(await screen.findByTestId('speaker-verification-question')).toHaveTextContent('Marco');
    await user.click(screen.getByTestId('speaker-verify-yes'));
    expect(await screen.findByTestId('speaker-verification-question')).toHaveTextContent('Priya');
    expect(screen.queryByText(/Marco/)).not.toBeInTheDocument();
    await user.click(screen.getByTestId('speaker-verify-no'));
    await waitFor(() => {
      expect(answerSpeakerVerification).toHaveBeenLastCalledWith('job-1038', 'v-priya', {
        id: 'v-priya',
        answer: 'no',
      });
    });
    await waitFor(() => {
      expect(screen.queryByTestId('speaker-verification')).not.toBeInTheDocument();
    });
  });

  it('clears a stale tentative role guess after Someone else with only a role', async () => {
    const user = userEvent.setup();
    const nameGuess = {
      id: 'v-name',
      proofId: 'clip-north',
      question: 'Is Speaker 3 in North slope walkthrough at 1:05 Marco?',
      speakerLabel: 'Speaker 3',
      clipTitle: 'North slope walkthrough',
      tSec: 65,
      candidateName: 'Marco',
      role: null,
      quote: "I'm Marco",
    };
    const sameClip = {
      id: 'v-role',
      proofId: 'clip-north',
      question: 'Is Speaker 3 in North slope walkthrough at 1:05 the homeowner?',
      speakerLabel: 'Speaker 3',
      clipTitle: 'North slope walkthrough',
      tSec: 65,
      candidateName: null,
      role: 'homeowner' as const,
      quote: 'The deductible on my house is still open.',
    };
    const otherClipSameTitle = {
      id: 'v-other-clip',
      proofId: 'clip-b',
      question: 'Is Speaker 3 in North slope walkthrough at 2:10 the crew?',
      speakerLabel: 'Speaker 3',
      clipTitle: 'North slope walkthrough',
      tSec: 130,
      candidateName: null,
      role: 'crew' as const,
      quote: 'Meet me at the garage door.',
    };
    answerSpeakerVerification.mockResolvedValue({ verifications: [sameClip, otherClipSameTitle] });
    render(
      <JobFileFocusProvider>
        <JobAskPanel jobId="job-1038" file={{ record, proofs }} initialVerifications={[nameGuess]} />
      </JobFileFocusProvider>,
    );
    expect(await screen.findByTestId('speaker-verification-question')).toHaveTextContent('Marco');
    await user.click(screen.getByTestId('speaker-verify-other'));
    await user.selectOptions(screen.getByTestId('speaker-verify-role'), 'adjuster');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/garage door/)).toBeInTheDocument();
    expect(screen.queryByText(/deductible/i)).not.toBeInTheDocument();
    expect(answerSpeakerVerification).toHaveBeenCalledWith(
      'job-1038',
      'v-name',
      expect.objectContaining({ id: 'v-name', answer: 'other', role: 'adjuster' }),
    );
  });

  it('keeps a role question on another clip that shares the title', async () => {
    const user = userEvent.setup();
    const nameGuess = {
      id: 'v-name',
      proofId: 'clip-north',
      question: 'Is Speaker 3 in North slope walkthrough at 1:05 Marco?',
      speakerLabel: 'Speaker 3',
      clipTitle: 'North slope walkthrough',
      tSec: 65,
      candidateName: 'Marco',
      role: null,
      quote: "I'm Marco",
    };
    const sameClipRole = {
      id: 'v-role',
      proofId: 'clip-north',
      question: 'Is Speaker 3 in North slope walkthrough at 1:05 the homeowner?',
      speakerLabel: 'Speaker 3',
      clipTitle: 'North slope walkthrough',
      tSec: 65,
      candidateName: null,
      role: 'homeowner' as const,
      quote: 'The deductible on my house is still open.',
    };
    const otherClipRole = {
      id: 'v-role-other',
      proofId: 'clip-east',
      question: 'Is Speaker 3 in North slope walkthrough at 2:00 the homeowner?',
      speakerLabel: 'Speaker 3',
      clipTitle: 'North slope walkthrough',
      tSec: 120,
      candidateName: null,
      role: 'homeowner' as const,
      quote: 'This other roof still needs a look.',
    };
    answerSpeakerVerification.mockResolvedValue({ verifications: [sameClipRole, otherClipRole] });
    render(
      <JobFileFocusProvider>
        <JobAskPanel
          jobId="job-1038"
          file={{ record, proofs }}
          initialVerifications={[nameGuess, sameClipRole, otherClipRole]}
        />
      </JobFileFocusProvider>,
    );
    expect(await screen.findByTestId('speaker-verification-question')).toHaveTextContent('Marco');
    await user.click(screen.getByTestId('speaker-verify-other'));
    await user.selectOptions(screen.getByTestId('speaker-verify-role'), 'crew');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByTestId('speaker-verification-question')).toHaveTextContent('at 2:00');
    expect(screen.queryByText(/deductible/i)).not.toBeInTheDocument();
  });

  it('does not revive the document card when the job already has an upload', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/operations/shared/') && url.includes('/documents')) {
        return new Response(
          JSON.stringify({
            documents: [
              {
                id: '00000000-0000-4000-8000-00000000d303',
                filename: 'The Future.docx',
                mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                byteSize: 32,
                kind: 'other',
                kindLabel: 'Document',
                relevance: 'not_related',
                relevanceReason: 'Nothing on the document matches the job name, address, or claim.',
                summary: 'The Future By Jack Cyganiak 8/11/2023 My companies and vision.',
                attached: false,
                jobId: null,
                contextJobId: 'job-1038',
                suggestedJobId: null,
                suggestedJobTitle: null,
                macrosIgnored: false,
                createdAt: '2026-10-01T00:00:00Z',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }) as typeof fetch;
    try {
      render(
        <JobFileFocusProvider>
          <JobAskPanel jobId="job-1038" file={{ record, proofs }} />
        </JobFileFocusProvider>,
      );
      await screen.findByPlaceholderText('Ask what you forgot…');
      await waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalled();
      });
      expect(screen.queryByTestId('ask-document-card')).not.toBeInTheDocument();
      expect(screen.queryByText('Not related')).not.toBeInTheDocument();
      expect(screen.queryByText(/Nothing on the document matches/)).not.toBeInTheDocument();
      expect(screen.queryByText(/My companies and vision/)).not.toBeInTheDocument();
      expect(screen.queryByText(/^DOCUMENT$/)).not.toBeInTheDocument();
      expect(screen.queryByTestId('ask-composer-attachments')).not.toBeInTheDocument();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('shows an upload chip and keeps the document for a follow-up', async () => {
    const user = userEvent.setup();
    askAboutProofs.mockImplementation(async (_jobId: string, question: string) => ({
      answer: question.startsWith('what is')
        ? "The Future.docx is a document about Jack Cyganiak's companies and vision.\n\nThis document doesn't appear to be about this job."
        : 'The Future.docx describes Jettx, long-distance wireless power.',
      groundedOn: 0,
      model: null,
      question: {
        id: question.startsWith('what is') ? 'q-about' : 'q-follow',
        question,
        answer: 'answered',
        grounded_on: [],
        created_at: '2026-10-01T00:00:00Z',
      },
    }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/operations/documents') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            document: {
              id: '00000000-0000-4000-8000-00000000d303',
              filename: 'The Future.docx',
              mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              byteSize: 32,
              kind: 'other',
              kindLabel: 'Document',
              relevance: 'not_related',
              relevanceReason: 'Nothing on the document matches the job name, address, or claim.',
              summary: 'Document. The Future By Jack Cyganiak 8/11/2023 My companies and vision',
              attached: false,
              jobId: null,
              contextJobId: 'job-1038',
              suggestedJobId: null,
              suggestedJobTitle: null,
              macrosIgnored: false,
              createdAt: '2026-10-01T00:00:00Z',
            },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ documents: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      render(
        <JobFileFocusProvider>
          <JobAskPanel jobId="job-1038" file={{ record, proofs }} />
        </JobFileFocusProvider>,
      );
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      await user.upload(input, new File(['vision'], 'The Future.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));

      const composer = await screen.findByTestId('ask-composer-attachments');
      expect(composer).toHaveTextContent('The Future.docx');
      expect(composer).not.toHaveTextContent('Not related');
      expect(screen.queryByTestId('ask-document-card')).not.toBeInTheDocument();
      expect(screen.queryByText(/Nothing on the document matches/)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Remove The Future.docx' })).toBeInTheDocument();

      const box = screen.getByPlaceholderText('Ask what you forgot…');
      await user.type(box, 'what is this about');
      await user.click(screen.getByRole('button', { name: 'Ask this job' }));

      expect(await screen.findByTestId('ask-message-attachments')).toHaveTextContent('DOCX');
      expect(screen.queryByTestId('ask-composer-attachments')).not.toBeInTheDocument();
      expect(screen.queryByTestId('ask-document-card')).not.toBeInTheDocument();
      await waitFor(() => {
        expect(askAboutProofs).toHaveBeenCalledWith('job-1038', 'what is this about', {
          threadId: 'thr-1',
          documentIds: ['00000000-0000-4000-8000-00000000d303'],
        });
      });

      await user.type(box, 'what address does it give?');
      await user.click(screen.getByRole('button', { name: 'Ask this job' }));
      await waitFor(() => {
        expect(askAboutProofs).toHaveBeenLastCalledWith('job-1038', 'what address does it give?', {
          threadId: 'thr-1',
          documentIds: ['00000000-0000-4000-8000-00000000d303'],
        });
      });
      expect(screen.getAllByTestId('ask-message-attachments')).toHaveLength(1);
      // No job-match note, and an older stored answer that ends with it renders without it.
      expect(screen.queryByTestId('ask-document-job-note')).not.toBeInTheDocument();
      expect(screen.queryByText(/doesn't appear to be about this job/)).not.toBeInTheDocument();
      expect(await screen.findByText(/Jack Cyganiak's companies and vision/)).toBeInTheDocument();
      expect(screen.queryByText('From this job file')).not.toBeInTheDocument();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('restores the uploaded file after the thread reloads', async () => {
    const user = userEvent.setup();
    const uploadId = '00000000-0000-4000-8000-00000000d303';
    proofQuestions.mockResolvedValue({
      questions: [
        {
          id: 'q-about',
          question: 'what is this about',
          answer: "This is a 2023 vision note by Jack Cyganiak.\n\nThis document doesn't appear to be about this job.",
          model: null,
          grounded_on: [],
          document_ids: [uploadId],
          created_at: '2026-10-01T00:00:00Z',
        },
      ],
    });
    askAboutProofs.mockResolvedValue({
      answer: 'Jack Cyganiak wrote it.',
      groundedOn: 0,
      model: null,
      question: {
        id: 'q-follow',
        question: 'Who wrote it?',
        answer: 'Jack Cyganiak wrote it.',
        grounded_on: [],
        created_at: '2026-10-01T00:02:00Z',
      },
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/operations/shared/') && url.includes('/documents')) {
        return new Response(
          JSON.stringify({
            documents: [
              {
                id: uploadId,
                filename: 'The Future.docx',
                mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                byteSize: 32,
                kind: 'other',
                kindLabel: 'Document',
                relevance: 'not_related',
                relevanceReason: 'Nothing on the document matches the job name, address, or claim.',
                summary: null,
                attached: false,
                jobId: null,
                contextJobId: 'job-1038',
                suggestedJobId: null,
                suggestedJobTitle: null,
                macrosIgnored: false,
                createdAt: '2026-10-01T00:00:00Z',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }) as typeof fetch;
    try {
      render(
        <JobFileFocusProvider>
          <JobAskPanel jobId="job-1038" file={{ record, proofs }} />
        </JobFileFocusProvider>,
      );
      expect(await screen.findByTestId('ask-message-attachments')).toHaveTextContent('The Future.docx');
      expect(screen.queryByTestId('ask-composer-attachments')).not.toBeInTheDocument();
      const box = screen.getByPlaceholderText('Ask what you forgot…');
      await user.type(box, 'Who wrote it?');
      await user.click(screen.getByRole('button', { name: 'Ask this job' }));
      await waitFor(() => {
        expect(askAboutProofs).toHaveBeenCalledWith('job-1038', 'Who wrote it?', {
          threadId: 'thr-1',
          documentIds: [uploadId],
        });
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('shows a document excerpt with the file name and no speaker', async () => {
    askAboutProofs.mockResolvedValue({
      answer:
        'Blox Group works on automated construction.\n\n⟦quotes: doc:00000000-0000-4000-8000-00000000d303#document||Blox Group – Automated construction, Flying movable apartment units.|clip=The Future.docx ;; video/job-1038/p1/walk@4.2|Unidentified speaker|The tarp came off the north slope.|clip=Walkthrough⟧',
      groundedOn: 0,
      model: null,
      question: null,
    });
    const user = userEvent.setup();
    render(
      <JobFileFocusProvider>
        <JobAskPanel jobId="job-1038" file={{ record, proofs }} />
      </JobFileFocusProvider>,
    );
    const box = await screen.findByPlaceholderText('Ask what you forgot…');
    await user.type(box, 'what does Blox Group do?');
    await user.click(screen.getByRole('button', { name: 'Ask this job' }));
    const quotes = await screen.findAllByTestId('ask-quote');
    expect(quotes).toHaveLength(2);
    expect(quotes[0]).toHaveTextContent('The Future.docx');
    expect(quotes[0]).not.toHaveTextContent(/Unidentified speaker/);
    expect(quotes[0]).not.toHaveTextContent(/^·|· ·/);
    // Transcript quotes keep their speaker label.
    expect(quotes[1]).toHaveTextContent('Unidentified speaker · Walkthrough');
    expect(screen.getByText('Blox Group works on automated construction.')).toBeInTheDocument();
  });

  it('sends a one-character message and shows a friendly line instead of a validation error', async () => {
    const { ApiError } = await import('../lib/api');
    const user = userEvent.setup();
    askAboutProofs.mockResolvedValueOnce({
      answer: 'Happy to help. Ask me about the clips, the scope, or who is on this job.',
      groundedOn: 0,
      model: null,
      question: null,
    });
    render(
      <JobFileFocusProvider>
        <JobAskPanel jobId="job-1038" file={{ record, proofs }} />
      </JobFileFocusProvider>,
    );
    const box = await screen.findByPlaceholderText('Ask what you forgot…');
    await user.type(box, '?');
    await user.click(screen.getByRole('button', { name: 'Ask this job' }));
    await waitFor(() => {
      expect(askAboutProofs).toHaveBeenCalledWith('job-1038', '?', { threadId: 'thr-1' });
    });
    expect(await screen.findByText(/Happy to help/)).toBeInTheDocument();

    askAboutProofs.mockRejectedValueOnce(
      new (ApiError as unknown as new (s: number, m: string, c: string) => Error)(
        400,
        'String must contain at least 3 character(s)',
        'validation_error',
      ),
    );
    await user.type(box, 'ok');
    await user.click(screen.getByRole('button', { name: 'Ask this job' }));
    const failure = await screen.findByTestId('ask-error');
    expect(failure).not.toHaveTextContent(/String must contain/);
    expect(failure).toHaveTextContent(/didn't go through/);
  });


  describe('answer feedback, pins, edits, action cards and search', () => {
    const Q1 = '11111111-1111-4111-8111-111111111111';
    const Q2 = '22222222-2222-4222-8222-222222222222';
    const ANSWER = 'Two items are still outstanding: the base trim is not installed, and the crew has to come back Tuesday to patch the drywall.';

    function streamAnswers() {
      let n = 0;
      askAboutProofsStream.mockImplementation(async (_jobId: string, question: string) => {
        n += 1;
        const id = n === 1 ? Q1 : Q2;
        const answer = n === 1 ? ANSWER : `Edited answer for: ${question}`;
        return { answer, groundedOn: 1, model: 'claude-opus', question: { id, question, answer, grounded_on: ['p1'], created_at: `2026-10-09T10:0${n}:00Z` } };
      });
    }

    async function askOnce(user: ReturnType<typeof userEvent.setup>, text = 'What is left on the kitchen?') {
      const box = await screen.findByPlaceholderText(/ask what you forgot/i);
      await user.type(box, text);
      await user.click(screen.getByRole('button', { name: /ask this job/i }));
      expect(await screen.findByText(/still outstanding/i)).toBeInTheDocument();
    }

    function renderPanel(props: Partial<Parameters<typeof JobAskPanel>[0]> = {}) {
      return render(
        <JobFileFocusProvider>
          <VideoSeekProvider>
            <JobAskPanel jobId="job-1038" file={{ record, proofs }} {...props} />
          </VideoSeekProvider>
        </JobFileFocusProvider>,
      );
    }

    it('rates an answer thumbs down with a reason', async () => {
      streamAnswers();
      const user = userEvent.setup();
      renderPanel();
      await askOnce(user);
      await user.click(screen.getByTestId('ask-thumbs-down'));
      expect(rateAskAnswer).toHaveBeenCalledWith('job-1038', Q1, -1, undefined);
      await user.click(within(screen.getByTestId('ask-feedback-reasons')).getByRole('button', { name: 'Incomplete' }));
      expect(rateAskAnswer).toHaveBeenLastCalledWith('job-1038', Q1, -1, { reason: 'incomplete' });
      expect(await screen.findByTestId('ask-feedback-thanks')).toBeInTheDocument();
      expect(screen.getByTestId('ask-thumbs-down')).toHaveAttribute('aria-pressed', 'true');
    });

    it('pins an answer for the team and copies a link to it', async () => {
      streamAnswers();
      const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
      pinAskAnswer.mockResolvedValue({
        pins: [{ id: 'pin-1', questionId: Q1, question: 'What is left on the kitchen?', answer: ANSWER, askedAt: '2026-10-09T10:01:00Z', pinnedAt: '2026-10-09T10:05:00Z', pinnedBy: 'Sam Office' }],
      });
      const user = userEvent.setup();
      renderPanel();
      await askOnce(user);
      await user.click(screen.getByTestId('ask-pin'));
      expect(pinAskAnswer).toHaveBeenCalledWith('job-1038', Q1);
      expect(await screen.findByText('Pinned answers (1)')).toBeInTheDocument();
      expect(screen.getByTestId('ask-pin')).toHaveTextContent('Unpin');
      await user.click(screen.getByTestId('ask-copy-link'));
      await waitFor(() => expect(writeText).toHaveBeenCalled());
      expect(String(writeText.mock.calls.at(-1)?.[0])).toContain(`askPin=${Q1}`);
    });

    it('edits a question: asks again in place, pointing at the one it replaces', async () => {
      streamAnswers();
      const user = userEvent.setup();
      renderPanel();
      await askOnce(user);
      await user.click(screen.getByTestId('ask-edit'));
      const box = screen.getByRole('textbox', { name: 'Edit your question' });
      await user.clear(box);
      await user.type(box, 'What is left in the bathroom?');
      await user.click(screen.getByTestId('ask-edit-send'));
      expect(await screen.findByText('Edited answer for: What is left in the bathroom?')).toBeInTheDocument();
      expect(askAboutProofsStream.mock.calls[1]?.[3]).toMatchObject({ supersedesId: Q1 });
      expect(screen.queryByText('What is left on the kitchen?')).not.toBeInTheDocument();
      expect(screen.queryByText(/still outstanding/i)).not.toBeInTheDocument();
    });

    it('offers next steps under the latest answer: send one, or start one in the box', async () => {
      streamAnswers();
      const user = userEvent.setup();
      renderPanel();
      await askOnce(user);
      const cards = screen.getAllByTestId('ask-action-card').map((b) => b.getAttribute('data-action'));
      expect(cards).toEqual(['punch', 'text-crew']);
      await user.click(screen.getByRole('button', { name: /text the crew/i }));
      expect(screen.getByPlaceholderText(/ask what you forgot/i)).toHaveValue('Text the crew about this: ');
      await user.click(screen.getByRole('button', { name: /make a punch list/i }));
      await waitFor(() => expect(askAboutProofsStream.mock.calls[1]?.[1]).toBe('Make a punch list from this.'));
    });

    it('searches past chats when the rail asks, and publishes the results', async () => {
      searchAskChats.mockResolvedValue({ results: [{ threadId: 'thr-1', threadTitle: 'Roof', questionId: Q1, snippet: 'roof tarp', at: '2026-10-09T10:00:00Z' }] });
      const { onAskHistory, publishAskHistoryAction } = await import('../lib/askHistoryBridge');
      const seen: unknown[] = [];
      const off = onAskHistory((payload) => {
        if (payload.search) seen.push(payload.search);
      });
      renderPanel();
      await screen.findByPlaceholderText(/ask what you forgot/i);
      publishAskHistoryAction({ type: 'search-threads', jobId: 'job-1038', query: 'tarp' });
      await waitFor(() => expect(seen).toEqual([{ query: 'tarp', results: [expect.objectContaining({ questionId: Q1 })] }]));
      expect(searchAskChats).toHaveBeenCalledWith('job-1038', 'tarp');
      off();
    });

    it('signed-in homeowners on a progress grant get none of the office extras', async () => {
      streamAnswers();
      const user = userEvent.setup();
      renderPanel({ officeExtras: false });
      await askOnce(user);
      expect(screen.queryByTestId('ask-thumbs-down')).not.toBeInTheDocument();
      expect(screen.queryByTestId('ask-edit')).not.toBeInTheDocument();
      expect(screen.queryByTestId('ask-action-cards')).not.toBeInTheDocument();
      expect(askPins).not.toHaveBeenCalled();
    });

    it('guests on a share link get none of the office extras', async () => {
      const askFn = vi.fn().mockResolvedValue({ answer: ANSWER, groundedOn: 1, model: null, question: { id: Q1, question: 'x', answer: ANSWER, grounded_on: [], created_at: '2026-10-09T10:00:00Z' } });
      const user = userEvent.setup();
      renderPanel({ ask: askFn });
      await askOnce(user);
      expect(screen.queryByTestId('ask-thumbs-up')).not.toBeInTheDocument();
      expect(screen.queryByTestId('ask-pin')).not.toBeInTheDocument();
      expect(screen.queryByTestId('ask-edit')).not.toBeInTheDocument();
      expect(screen.queryByTestId('ask-action-cards')).not.toBeInTheDocument();
      expect(askPins).not.toHaveBeenCalled();
    });
  });
});
