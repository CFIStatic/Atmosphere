import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { VIDEO_PLAYER_PREFS_KEY } from '../../lib/videoPlayerPrefs';
import { JobFilePlayer, activePrivacyRange, resolveActivePrivacy } from './JobFilePlayer';

describe('JobFilePlayer', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows mute, volume, and disabled CC when no transcript exists', () => {
    render(<JobFilePlayer src="https://signed.test/clip.mp4" className="w-full" />);
    expect(screen.getByTestId('job-file-player')).toBeInTheDocument();
    expect(screen.getByTestId('job-file-mute')).toBeInTheDocument();
    expect(screen.getByTestId('job-file-volume')).toBeInTheDocument();
    expect(screen.getByTestId('job-file-cc')).toBeDisabled();
    expect(screen.getByTestId('job-file-cc-unavailable')).toHaveTextContent('Captions unavailable');
    expect(document.querySelector('track')).toBeNull();
  });

  it('attaches a captions track from timestamped Whisper text', () => {
    render(
      <JobFilePlayer
        src="https://signed.test/clip.mp4"
        captions={{
          transcriptText: '[0:18] Homeowner: Leave the cabinets.\n[1:00] Contractor: Understood.',
          durationSeconds: 90,
        }}
      />,
    );
    const track = document.querySelector('track');
    expect(track).not.toBeNull();
    expect(track?.getAttribute('kind')).toBe('captions');
    expect(screen.getByTestId('job-file-cc')).not.toBeDisabled();
    expect(screen.queryByTestId('job-file-cc-unavailable')).toBeNull();
  });

  it('persists mute + volume to localStorage', async () => {
    const user = userEvent.setup();
    render(<JobFilePlayer src="https://signed.test/clip.mp4" />);
    await user.click(screen.getByTestId('job-file-mute'));
    const stored = JSON.parse(localStorage.getItem(VIDEO_PLAYER_PREFS_KEY) || '{}');
    expect(stored.muted).toBe(true);
  });

  it('shows captions pending when the mic is still being read', () => {
    render(
      <JobFilePlayer
        src="https://signed.test/clip.mp4"
        captions={{ status: 'pending', durationSeconds: 40 }}
      />,
    );
    expect(screen.getByTestId('job-file-cc')).toBeDisabled();
    expect(screen.getByTestId('job-file-cc-unavailable')).toHaveTextContent('Captions pending');
    expect(document.querySelector('track')).toBeNull();
  });

  it('activePrivacyRange matches inclusive private windows', () => {
    const ranges = [{ startSec: 10, endSec: 20, reason: 'bathroom', confidence: 0.8, source: 'vision' as const }];
    expect(activePrivacyRange(9.9, ranges)).toBeNull();
    expect(activePrivacyRange(10, ranges)?.reason).toBe('bathroom');
    expect(activePrivacyRange(19.9, ranges)?.reason).toBe('bathroom');
  });

  it('shows a privacy badge and hint when redaction ranges are provided', async () => {
    render(
      <JobFilePlayer
        src="https://signed.test/clip.mp4"
        privacyRedactions={[
          { startSec: 5, endSec: 15, reason: 'bathroom', confidence: 0.9, source: 'vision' },
        ]}
      />,
    );
    expect(screen.getByTestId('job-file-privacy-hint')).toHaveTextContent('Privacy-protected');
    const video = screen.getByTestId('job-file-player') as HTMLVideoElement;
    Object.defineProperty(video, 'currentTime', { configurable: true, get: () => 8, set: () => undefined });
    video.dispatchEvent(new Event('timeupdate'));
    await waitFor(() => {
      expect(screen.getByTestId('job-file-privacy-badge')).toHaveTextContent('Privacy protected');
    });
    expect(video.getAttribute('data-privacy-active')).toBe('1');
    expect(video.className).toMatch(/job-file-player-privacy-blur/);
    expect(video.muted).toBe(true);
  });


  it('resolveActivePrivacy prefers private moments over child ranges', () => {
    const active = resolveActivePrivacy(
      12,
      [{ startSec: 10, endSec: 20, reason: 'bathroom', confidence: 0.9, source: 'vision' }],
      [{ startSec: 10, endSec: 20, reason: 'child present', confidence: 0.9, source: 'vision' }],
    );
    expect(active?.kind).toBe('private');
  });

  it('blurs child ranges with Child privacy badge', async () => {
    render(
      <JobFilePlayer
        src="https://signed.test/clip.mp4"
        childPrivacyRedactions={[
          { startSec: 5, endSec: 15, reason: 'child present', confidence: 0.9, source: 'vision' },
        ]}
      />,
    );
    expect(screen.getByTestId('job-file-privacy-hint')).toHaveTextContent('Privacy-protected');
    const video = screen.getByTestId('job-file-player') as HTMLVideoElement;
    Object.defineProperty(video, 'currentTime', { configurable: true, get: () => 8, set: () => undefined });
    video.dispatchEvent(new Event('timeupdate'));
    await waitFor(() => {
      expect(screen.getByTestId('job-file-privacy-badge')).toHaveTextContent('Child privacy');
    });
    expect(video.getAttribute('data-privacy-kind')).toBe('child');
    expect(video.className).toMatch(/job-file-player-privacy-blur/);
    expect(video.muted).toBe(true);
  });

  it('uses region blur without force-mute when child boxes exist', async () => {
    render(
      <JobFilePlayer
        src="https://signed.test/clip.mp4"
        childPrivacyRedactions={[
          {
            startSec: 5,
            endSec: 15,
            reason: 'child present',
            confidence: 0.9,
            source: 'vision',
            regions: [{ x: 0.2, y: 0.1, w: 0.2, h: 0.3 }],
          },
        ]}
      />,
    );
    const video = screen.getByTestId('job-file-player') as HTMLVideoElement;
    Object.defineProperty(video, 'currentTime', { configurable: true, get: () => 8, set: () => undefined });
    video.dispatchEvent(new Event('timeupdate'));
    await waitFor(() => {
      expect(screen.getByTestId('job-file-child-region-blur')).toBeInTheDocument();
    });
    expect(video.className).not.toMatch(/job-file-player-privacy-blur/);
  });
});
