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
const answerSpeakerVerification = vi.fn();

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
    answerSpeakerVerification: (...args: unknown[]) => answerSpeakerVerification(...args),
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
    answerSpeakerVerification.mockReset();
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

  it('shows thinking dots and no partial text until the final answer lands', async () => {
    let release: () => void = () => {};
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    askAboutProofsStream.mockImplementation(
      async (
        _jobId: string,
        _q: string,
        handlers: { onToken?: (t: string) => void; onStatus?: (phase: string) => void },
      ) => {
        handlers.onToken?.("I'll look that up. ");
        handlers.onStatus?.('Searching transcripts');
        await paused;
        handlers.onToken?.('The tarp came off.');
        return {
          answer: 'The tarp came off.',
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
    expect(screen.queryByText('Searching transcripts')).not.toBeInTheDocument();
    expect(screen.queryByText(/I'll look that up/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('ask-answer-body')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ask-message-copy')).not.toBeInTheDocument();
    release();
    await pending;
    expect(await screen.findByText(/the tarp came off/i)).toBeInTheDocument();
    expect(screen.queryByTestId('ask-status')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('ask-answer-body')).toHaveLength(1);
    expect(screen.getByTestId('ask-message-copy')).toBeInTheDocument();
    expect(screen.queryByText(/I'll look that up/)).not.toBeInTheDocument();
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
      question: 'Is Speaker 2 in North slope walkthrough at 0:42 Marco?',
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

});
