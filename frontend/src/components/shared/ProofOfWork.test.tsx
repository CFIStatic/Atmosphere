import { useEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoSeekProvider, useVideoSeek } from '../../lib/videoSeek';
import type { ProofResponse } from '../../lib/api';

const proofVideoUrl = vi.fn();
const askAboutProofs = vi.fn();
const jobProofs = vi.fn();
const proofQuestions = vi.fn();
const jobEpisodes = vi.fn();
const evidenceLibrary = vi.fn();

vi.mock('../../lib/api', () => ({
  api: {
    proofVideoUrl: (...args: unknown[]) => proofVideoUrl(...args),
    askAboutProofs: (...args: unknown[]) => askAboutProofs(...args),
    jobProofs: (...args: unknown[]) => jobProofs(...args),
    proofQuestions: (...args: unknown[]) => proofQuestions(...args),
    jobEpisodes: (...args: unknown[]) => jobEpisodes(...args),
    evidenceLibrary: (...args: unknown[]) => evidenceLibrary(...args),
    episodePhysicalWork: vi.fn(),
    decideProofDay: vi.fn(),
    reanalyseProofDay: vi.fn(),
    requeueProofTranscript: vi.fn(),
    createPlaybookFromJob: vi.fn(),
    downloadProofPack: vi.fn(),
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
      transcriptText: '[0:08] We have not started the subfloor yet.',
      transcriptSegments: [
        { tSec: 8, text: 'We have not started the subfloor yet.', speakerLabel: null },
      ],
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
    askAboutProofs.mockResolvedValue({
      answer: 'The subfloor is mentioned on the morning clip.',
      groundedOn: 2,
    });
    proofQuestions.mockResolvedValue({ questions: [] });
    jobEpisodes.mockResolvedValue({ episodes: [] });
    evidenceLibrary.mockReset();
    evidenceLibrary.mockResolvedValue({ items: [] });
  });

  it('lists every uploaded video once with duration and status — no separate transcripts section', async () => {
    render(<ProofOfWork jobId="job-1" heading="Videos" initialData={catalog} />);

    expect(screen.getByRole('heading', { name: 'Videos' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Show me the dispute/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/None on this (clip|file)/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('job-video-list')).toBeInTheDocument();
    expect(screen.getByText(/2 videos on file/)).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /Transcripts and analysis/i }),
    ).not.toBeInTheDocument();
    // Dense Glance / Scan / Full evidence walls are off the job file.
    expect(screen.queryByTestId('full-evidence')).not.toBeInTheDocument();
    expect(screen.queryByTestId('verbatim-transcript')).not.toBeInTheDocument();
    expect(screen.queryByTestId('evidence-log')).not.toBeInTheDocument();
    expect(screen.queryByTestId('punch-list-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('save-as-playbook')).not.toBeInTheDocument();
    const statuses = screen.getAllByTestId('job-video-status').map((el) => el.textContent);
    expect(statuses).toEqual(['Analyzed', 'Processing']);
    expect(screen.getByText('42 seconds')).toBeInTheDocument();
    expect(screen.getByText('10 minutes')).toBeInTheDocument();
    expect(screen.queryByText(/Field Capture/)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Ask the video collection/i)).toBeInTheDocument();
    // Hear-the-mic lives in the expanded row, not the collapsed list.
    expect(screen.queryByTestId('hear-the-mic')).not.toBeInTheDocument();
  });

  it('opens the named clip on a dispute tap and seeks once metadata is ready', async () => {
    const user = userEvent.setup();
    const withDispute: ProofResponse = {
      ...catalog,
      disputes: [
        {
          id: 'integrity:proof-morning:on_site',
          kind: 'integrity',
          severity: 'high',
          title: 'Filmed on site',
          detail: 'Filmed 2.14 miles from the site — a different address.',
          proofId: 'proof-morning',
          seekSeconds: 41,
          workDate: '2026-08-20',
          partyId: 'party-1',
          company: 'Acme Drywall',
          phase: 'before',
          relatedProofIds: ['proof-morning'],
          scopeTitle: null,
        },
      ],
    };
    const videoFetcher = vi.fn().mockResolvedValue({ url: 'https://signed.test/morning.mp4' });
    render(
      <ProofOfWork
        jobId="job-1"
        heading="Videos"
        initialData={withDispute}
        videoFetcher={videoFetcher}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Show me the dispute/i }));
    await user.click(screen.getByText('Filmed on site'));

    await waitFor(() => expect(videoFetcher).toHaveBeenCalledWith('proof-morning'));
    const video = (await screen.findByTestId('job-file-player')) as HTMLVideoElement;
    expect(video.getAttribute('src')).toBe('https://signed.test/morning.mp4');
    expect(video).toHaveAttribute('data-seek', '41');
    Object.defineProperty(video, 'readyState', { configurable: true, get: () => 1 });
    video.dispatchEvent(new Event('loadedmetadata'));
    video.dispatchEvent(new Event('seeked'));
    expect(video.currentTime).toBe(41);
  });

  it('loads a signed URL when Play is clicked and shows transcript with Copy', async () => {
    const user = userEvent.setup();
    const videoFetcher = vi.fn().mockResolvedValue({ url: 'https://signed.test/morning.mp4' });
    render(
      <ProofOfWork
        jobId="job-1"
        heading="Videos"
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
    expect(await screen.findByTestId('job-video-expansion')).toBeInTheDocument();
    expect(await screen.findByTestId('verbatim-transcript')).toBeInTheDocument();
    expect(screen.getByTestId('copy-transcript')).toHaveTextContent('Copy');
    expect(screen.queryByTestId('full-evidence')).not.toBeInTheDocument();
    expect(screen.queryByTestId('evidence-log')).not.toBeInTheDocument();
  });

  it('shows volume controls and captions when a Whisper transcript exists', async () => {
    const user = userEvent.setup();
    const videoFetcher = vi.fn().mockResolvedValue({ url: 'https://signed.test/morning.mp4' });
    render(
      <ProofOfWork
        jobId="job-1"
        heading="Videos"
        initialData={catalog}
        videoFetcher={videoFetcher}
      />,
    );

    await user.click(screen.getAllByRole('button', { name: 'Play' })[0]!);
    expect(await screen.findByTestId('job-file-mute')).toBeInTheDocument();
    expect(screen.getByTestId('job-file-volume')).toBeInTheDocument();
    expect(screen.getByTestId('job-file-cc')).not.toBeDisabled();
    const video = document.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'currentTime', { configurable: true, get: () => 8 });
    video.dispatchEvent(new Event('timeupdate'));
    expect(await screen.findByTestId('job-file-caption')).toHaveTextContent(/subfloor/i);
    expect(document.querySelector('track')).toBeNull();
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

    render(<ProofOfWork jobId="job-1" heading="Videos" />);

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

  it('picks up the Dashboard title and poster when analysis finishes on an existing clip', async () => {
    vi.useFakeTimers();
    const processing = {
      id: 'proof-morning',
      partyId: 'party-1',
      company: 'Acme Drywall',
      workDate: '2026-08-20',
      phase: 'before',
      durationSeconds: 42,
      analysisStatus: 'queued',
      narrationStatus: 'running',
      transcriptStatus: 'queued',
      transcriptError: null,
      aiSummary: null,
      heardOnMic: null,
    };
    jobProofs.mockResolvedValue({
      days: [],
      videos: [processing],
      counts: { days: 0, videos: 1, payable: 0, contradicted: 0, awaitingAfter: 0, analysing: 1 },
      siteKnown: true,
    });
    evidenceLibrary.mockResolvedValue({ items: [] });

    render(<ProofOfWork jobId="job-1" heading="Videos" />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId('job-video-status')).toHaveTextContent('Processing');
    expect(screen.getByTestId('job-video-title')).toHaveTextContent(/Video ·/);
    expect(screen.getByTestId('job-video-thumb').querySelector('img')).toBeNull();
    const libraryCalls = evidenceLibrary.mock.calls.length;
    expect(libraryCalls).toBeGreaterThan(0);

    jobProofs.mockResolvedValue({
      days: [],
      videos: [
        {
          ...processing,
          analysisStatus: 'done',
          narrationStatus: 'done',
          transcriptStatus: 'done',
        },
      ],
      counts: { days: 0, videos: 1, payable: 0, contradicted: 0, awaitingAfter: 0, analysing: 0 },
      siteKnown: true,
    });
    evidenceLibrary.mockResolvedValue({
      items: [
        {
          id: 'proof-morning',
          jobId: 'job-1',
          title: 'Empty hall before drywall',
          aiTitle: 'Empty hall before drywall',
          posterUrl: 'https://storage.test/poster-morning.jpg',
        },
      ],
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });

    expect(evidenceLibrary.mock.calls.length).toBeGreaterThan(libraryCalls);
    expect(screen.getByTestId('job-video-status')).toHaveTextContent('Analyzed');
    expect(screen.getByTestId('job-video-title')).toHaveTextContent('Empty hall before drywall');
    expect(screen.getByTestId('job-video-thumb').querySelector('img')?.getAttribute('src')).toBe(
      'https://storage.test/poster-morning.jpg',
    );
    vi.useRealTimers();
  });

  it('opens the cited clip and seeks to the Analysis second', async () => {
    function FireSeek() {
      const { seek } = useVideoSeek();
      useEffect(() => {
        seek({ atSeconds: 18, proofId: 'proof-morning' });
      }, [seek]);
      return null;
    }
    const videoFetcher = vi.fn().mockResolvedValue({ url: 'https://signed.test/morning.mp4' });
    render(
      <VideoSeekProvider>
        <FireSeek />
        <ProofOfWork
          jobId="job-1"
          heading="Videos"
          initialData={catalog}
          videoFetcher={videoFetcher}
          showCollectionAsk={false}
        />
      </VideoSeekProvider>,
    );

    await waitFor(() => {
      expect(videoFetcher).toHaveBeenCalledWith('proof-morning');
    });
    const player = await screen.findByTestId('job-file-player');
    expect(player).toHaveAttribute('src', 'https://signed.test/morning.mp4');
    expect(player).toHaveAttribute('data-seek', '18');
    // Seek must not scrollIntoView the player (that yanked the page / could auto-pause).
  });

  it('re-seeks the same Analysis second after the playhead moves', async () => {
    let fire: ((target: { atSeconds: number; proofId: string }) => void) | undefined;
    function FireSeek() {
      const { seek } = useVideoSeek();
      useEffect(() => {
        fire = seek;
        seek({ atSeconds: 18, proofId: 'proof-morning' });
      }, [seek]);
      return null;
    }
    const videoFetcher = vi.fn().mockResolvedValue({ url: 'https://signed.test/morning.mp4' });
    render(
      <VideoSeekProvider>
        <FireSeek />
        <ProofOfWork
          jobId="job-1"
          heading="Videos"
          initialData={catalog}
          videoFetcher={videoFetcher}
          showCollectionAsk={false}
        />
      </VideoSeekProvider>,
    );

    const player = (await screen.findByTestId('job-file-player')) as HTMLVideoElement;
    Object.defineProperty(player, 'readyState', { configurable: true, get: () => 2 });
    player.currentTime = 5;
    expect(fire).toBeDefined();
    act(() => {
      fire!({ atSeconds: 18, proofId: 'proof-morning' });
    });
    await waitFor(() => {
      expect(player.currentTime).toBe(18);
    });
  });

  it('copies the transcript text from the expanded clip', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const videoFetcher = vi.fn().mockResolvedValue({ url: 'https://signed.test/morning.mp4' });
    render(
      <ProofOfWork
        jobId="job-1"
        heading="Videos"
        initialData={catalog}
        videoFetcher={videoFetcher}
        showCollectionAsk={false}
      />,
    );
    await user.click(screen.getAllByRole('button', { name: 'Play' })[0]!);
    await user.click(await screen.findByTestId('copy-transcript'));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(String(writeText.mock.calls[0]![0])).toMatch(/We have not started the subfloor yet/);
    expect(screen.getByTestId('copy-transcript')).toHaveTextContent('Copied');
  });

  it('names each row and shows its thumbnail exactly as the Dashboard does', async () => {
    evidenceLibrary.mockResolvedValue({
      items: [
        {
          id: 'proof-morning',
          jobId: 'job-1',
          title: 'Empty hall before drywall',
          customTitle: null,
          aiTitle: 'Empty hall before drywall',
          posterUrl: 'https://storage.test/poster-morning.jpg',
        },
        { id: 'other-job-clip', jobId: 'job-2', title: 'Not this job', posterUrl: null },
      ],
    });
    render(<ProofOfWork jobId="job-1" heading="Videos" initialData={catalog} />);

    await waitFor(() => {
      expect(screen.getAllByTestId('job-video-title')[0]).toHaveTextContent(
        'Empty hall before drywall',
      );
    });
    expect(evidenceLibrary).toHaveBeenCalledWith('job-1');
    expect(screen.getAllByTestId('job-video-title')[1]).toHaveTextContent('Video · proofday');
    const thumbs = screen.getAllByTestId('job-video-thumb');
    expect(thumbs[0].querySelector('img')?.getAttribute('src')).toBe(
      'https://storage.test/poster-morning.jpg',
    );
    expect(thumbs[0]).toHaveTextContent('0:42');
    expect(thumbs[1].querySelector('img')).toBeNull();
    expect(thumbs[1]).toHaveTextContent('10:00');
  });

  it('jumps to a moment from the row', async () => {
    const user = userEvent.setup();
    render(<ProofOfWork jobId="job-1" heading="Videos" initialData={catalog} />);
    const moments = screen.getAllByTestId('job-video-moments');
    expect(moments).toHaveLength(1);
    const chip = screen.getByRole('button', {
      name: 'Jump to 0:08: We have not started the subfloor yet.',
    });
    await user.click(chip);
    expect(screen.getByTestId('job-video-expansion')).toBeInTheDocument();
  });
});
