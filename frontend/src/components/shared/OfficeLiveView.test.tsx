import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { OfficeLiveView } from './OfficeLiveView';

const jobLiveSessions = vi.fn();
const jobLiveSession = vi.fn();

vi.mock('../../lib/api', () => ({
  api: {
    jobLiveSessions: (...args: unknown[]) => jobLiveSessions(...args),
    jobLiveSession: (...args: unknown[]) => jobLiveSession(...args),
  },
}));

vi.mock('./officeLiveRtc', () => ({
  connectOfficeLiveRtc: () => ({
    stop: vi.fn(),
  }),
}));

describe('OfficeLiveView', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    jobLiveSessions.mockReset();
    jobLiveSession.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when no live sessions', async () => {
    jobLiveSessions.mockResolvedValue({
      sessions: [],
      latencyNote: '',
      privacyNote: '',
      pollIntervalSeconds: 2,
      signalPath: '/api/live/signal',
      iceServers: [],
    });
    const { container } = render(<OfficeLiveView jobId="job-1" />);
    await waitFor(() => expect(jobLiveSessions).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="office-live-view"]')).toBeNull();
  });

  it('shows Live / Watch now when a session is active', async () => {
    jobLiveSessions.mockResolvedValue({
      sessions: [
        {
          clipId: 'clipabc',
          partyId: 'p1',
          workDate: '2026-09-15',
          phase: 'before',
          mimeType: 'video/webm',
          extension: 'webm',
          storagePath: 'o/j/c.webm',
          startedAt: new Date().toISOString(),
          lastPartAt: new Date().toISOString(),
          lastMintIndex: 0,
          status: 'live',
          latencyNote: 'Live (WebRTC): typically ≤1–2 seconds',
          privacyNote: 'Live may show raw video',
          realtimePublisher: false,
          signalPath: '/api/live/signal',
        },
      ],
      latencyNote: 'Live (WebRTC): typically ≤1–2 seconds',
      privacyNote: '',
      pollIntervalSeconds: 2,
      signalPath: '/api/live/signal',
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    jobLiveSession.mockResolvedValue({
      session: {
        clipId: 'clipabc',
        partyId: 'p1',
        workDate: '2026-09-15',
        phase: 'before',
        mimeType: 'video/webm',
        extension: 'webm',
        storagePath: 'o/j/c.webm',
        startedAt: new Date().toISOString(),
        lastPartAt: new Date().toISOString(),
        lastMintIndex: 0,
        status: 'live',
        latencyNote: 'Live (WebRTC): typically ≤1–2 seconds',
        privacyNote: 'Live may show raw video',
        realtimePublisher: false,
        signalPath: '/api/live/signal',
      },
      parts: [],
      partCount: 0,
      ready: false,
      expiresInSeconds: 600,
      latencyNote: '',
      privacyNote: 'Live may show raw video',
      pollIntervalSeconds: 2,
      signalPath: '/api/live/signal',
      iceServers: [],
    });
    render(<OfficeLiveView jobId="job-1" />);
    expect(await screen.findByTestId('office-live-view')).toBeInTheDocument();
    expect(screen.getByText('Watch now')).toBeInTheDocument();
    expect(screen.getByText(/Field Capture on site/i)).toBeInTheDocument();
    expect(screen.getByText(/≤1–2/)).toBeInTheDocument();
  });
});
