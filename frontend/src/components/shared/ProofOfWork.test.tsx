import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProofResponse } from '../../lib/api';

const proofVideoUrl = vi.fn();
const askAboutProofs = vi.fn();
const jobProofs = vi.fn();
const proofQuestions = vi.fn();
const jobEpisodes = vi.fn();

vi.mock('../../lib/api', () => ({
  api: {
    proofVideoUrl: (...args: unknown[]) => proofVideoUrl(...args),
    askAboutProofs: (...args: unknown[]) => askAboutProofs(...args),
    jobProofs: (...args: unknown[]) => jobProofs(...args),
    proofQuestions: (...args: unknown[]) => proofQuestions(...args),
    jobEpisodes: (...args: unknown[]) => jobEpisodes(...args),
    episodePhysicalWork: vi.fn(),
    decideProofDay: vi.fn(),
    reanalyseProofDay: vi.fn(),
  },
}));

import { ProofOfWork } from './ProofOfWork';

const catalog: ProofResponse = {
  days: [],
  videos: [
    {
      id: 'proof-morning',
      partyId: 'party-1',
      company: 'Acme Drywall',
      workDate: '2026-08-20',
      phase: 'before',
      durationSeconds: 42,
      analysisStatus: 'done',
      narrationStatus: 'done',
      transcriptStatus: 'done',
      transcriptError: null,
      aiSummary: 'Empty hall before the crew started.',
      heardOnMic: 'We have not started the subfloor yet.',
    },
    {
      id: 'proof-day',
      partyId: 'party-1',
      company: 'Acme Drywall',
      workDate: '2026-08-20',
      phase: 'after',
      durationSeconds: 600,
      analysisStatus: 'queued',
      narrationStatus: 'running',
      transcriptStatus: 'skipped',
      transcriptError: 'Speech-to-text is not configured on this server.',
      aiSummary: null,
      heardOnMic: null,
    },
  ],
  counts: {
    days: 0,
    videos: 2,
    payable: 0,
    contradicted: 0,
    awaitingAfter: 0,
    analysing: 0,
  },
  siteKnown: true,
};

describe('ProofOfWork video collection', () => {
  beforeEach(() => {
    proofVideoUrl.mockReset();
    askAboutProofs.mockReset();
    jobProofs.mockReset();
    proofQuestions.mockReset();
    jobEpisodes.mockReset();
    proofVideoUrl.mockResolvedValue({ url: 'https://storage.test/clip.mp4' });
    askAboutProofs.mockResolvedValue({ answer: 'The subfloor is mentioned on the morning clip.', groundedOn: 2 });
    proofQuestions.mockResolvedValue({ questions: [] });
    jobEpisodes.mockResolvedValue({ episodes: [] });
  });

  it('lists every uploaded video with picture and mic status', () => {
    render(<ProofOfWork jobId="job-1" heading="Videos and analysis" initialData={catalog} />);

    expect(screen.getByRole('heading', { name: 'Videos and analysis' })).toBeInTheDocument();
    expect(screen.getByText('Every video on this job')).toBeInTheDocument();
    expect(screen.getByText(/2 videos on file/)).toBeInTheDocument();
    expect(screen.getByText(/Empty hall before the crew started/)).toBeInTheDocument();
    expect(screen.getByText(/On the mic: We have not started the subfloor yet/)).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.textContent === 'Picture: read · Mic: heard')).toBeInTheDocument();
    expect(
      screen.getByText((_, el) => el?.textContent === 'Picture: reading · Mic: skipped'),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/Ask the video collection/i),
    ).toBeInTheDocument();
  });

  it('loads a signed URL when Play is clicked', async () => {
    const user = userEvent.setup();
    const videoFetcher = vi.fn().mockResolvedValue({ url: 'https://signed.test/morning.mp4' });
    render(
      <ProofOfWork
        jobId="job-1"
        heading="Videos and analysis"
        initialData={catalog}
        videoFetcher={videoFetcher}
      />,
    );

    const playButtons = screen.getAllByRole('button', { name: 'Play' });
    await user.click(playButtons[0]!);

    expect(videoFetcher).toHaveBeenCalledWith('proof-morning');
    expect(document.querySelector('video')?.getAttribute('src')).toBe(
      'https://signed.test/morning.mp4',
    );
  });


  it('polls for new videos while the job file is open', async () => {
    vi.useFakeTimers();
    jobProofs.mockResolvedValue({
      days: [],
      videos: [],
      counts: { days: 0, videos: 0, payable: 0, contradicted: 0, awaitingAfter: 0, analysing: 0 },
      siteKnown: true,
    });
    proofQuestions.mockResolvedValue({ questions: [] });
    jobEpisodes.mockResolvedValue({ episodes: [] });

    render(<ProofOfWork jobId="job-1" heading="Videos and analysis" />);

    // Flush the initial load.
    await act(async () => {
      await Promise.resolve();
    });
    expect(jobProofs).toHaveBeenCalled();
    const callsAfterMount = jobProofs.mock.calls.length;

    jobProofs.mockResolvedValue({
      days: [],
      videos: [
        {
          id: 'proof-new',
          partyId: 'party-1',
          company: 'Acme Drywall',
          workDate: '2026-08-20',
          phase: 'after',
          durationSeconds: 30,
          analysisStatus: 'queued',
          narrationStatus: 'queued',
          transcriptStatus: 'queued',
          transcriptError: null,
          aiSummary: null,
          heardOnMic: null,
        },
      ],
      counts: { days: 0, videos: 1, payable: 0, contradicted: 0, awaitingAfter: 0, analysing: 1 },
      siteKnown: true,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(jobProofs.mock.calls.length).toBeGreaterThan(callsAfterMount);
    expect(screen.getByText(/New video filed on this job/i)).toBeInTheDocument();
    vi.useRealTimers();
  });

});
