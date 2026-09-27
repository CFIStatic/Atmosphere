import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VIDEO_PLAYER_PREFS_KEY } from '../../lib/videoPlayerPrefs';
import { JobFilePlayer, activePrivacyRange, resolveActivePrivacy } from './JobFilePlayer';

describe('JobFilePlayer', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('uses one custom scrubber and never the browser control bar', () => {
    render(<JobFilePlayer src="https://signed.test/clip.mp4" knownDurationSeconds={32} />);
    const video = screen.getByTestId('job-file-player') as HTMLVideoElement;
    expect(video.hasAttribute('controls')).toBe(false);
    expect(video.controls).toBe(false);
    expect(video).toHaveAttribute('playsinline');
    expect(video.getAttribute('controlslist')).toContain('nodownload');
    expect(video.getAttribute('controlslist')).toContain('noplaybackrate');
    expect(screen.getByTestId('job-file-scrub')).toHaveAttribute('role', 'slider');
    expect(screen.getByTestId('job-file-play')).toHaveAttribute('aria-label', 'Play');
    expect(screen.getByTestId('job-file-time')).toHaveTextContent('0:00 / 0:32');
    expect(screen.getByTestId('job-file-fullscreen')).toHaveAttribute('aria-label', 'Full screen');
  });

  it('keeps the same src while playback is underway', () => {
    const { rerender } = render(<JobFilePlayer src="https://signed.test/a.mp4" />);
    const video = screen.getByTestId('job-file-player') as HTMLVideoElement;
    Object.defineProperty(video, 'paused', { configurable: true, get: () => false });
    Object.defineProperty(video, 'ended', { configurable: true, get: () => false });
    video.dispatchEvent(new Event('play'));
    rerender(<JobFilePlayer src="https://signed.test/b.mp4?sig=2" />);
    expect(video.getAttribute('src')).toBe('https://signed.test/a.mp4');
  });

  it('shows mute, volume, and disabled CC when no transcript exists', () => {
    render(<JobFilePlayer src="https://signed.test/clip.mp4" className="w-full" />);
    expect(screen.getByTestId('job-file-player')).toBeInTheDocument();
    expect(screen.getByTestId('job-file-mute')).toBeInTheDocument();
    expect(screen.getByTestId('job-file-volume')).toBeInTheDocument();
    expect(screen.getByTestId('job-file-cc')).toBeDisabled();
    expect(screen.getByTestId('job-file-cc')).toHaveAttribute('title', 'No captions available');
    expect(screen.getByTestId('job-file-cc-unavailable')).toHaveTextContent('No captions available');
    expect(document.querySelector('track')).toBeNull();
    expect(screen.queryByTestId('job-file-caption')).toBeNull();
  });

  it('draws the current transcript line in a caption overlay', async () => {
    render(
      <JobFilePlayer
        src="https://signed.test/clip.mp4"
        captions={{
          transcriptText: '[0:18] Homeowner: Leave the cabinets.\n[1:00] Contractor: Understood.',
          durationSeconds: 90,
        }}
      />,
    );
    expect(document.querySelector('track')).toBeNull();
    expect(screen.getByTestId('job-file-cc')).not.toBeDisabled();
    expect(screen.getByTestId('job-file-cc')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('job-file-cc-unavailable')).toBeNull();
    expect(screen.queryByTestId('job-file-caption')).toBeNull();

    const video = screen.getByTestId('job-file-player') as HTMLVideoElement;
    Object.defineProperty(video, 'currentTime', { configurable: true, get: () => 18 });
    video.dispatchEvent(new Event('timeupdate'));
    expect(await screen.findByTestId('job-file-caption')).toHaveTextContent('Leave the cabinets');

    await userEvent.setup().click(screen.getByTestId('job-file-cc'));
    expect(screen.queryByTestId('job-file-caption')).toBeNull();
    expect(screen.getByTestId('job-file-cc')).toHaveAttribute('aria-pressed', 'false');
  });

  it('rolls word-timed captions two lines at a time', async () => {
    render(
      <JobFilePlayer
        src="https://signed.test/clip.mp4"
        captions={{
          words: [
            { text: 'by', startSec: 0, endSec: 0.2 },
            { text: 'bad', startSec: 0.2, endSec: 0.4 },
            { text: 'actors,', startSec: 0.4, endSec: 0.7 },
            { text: 'but', startSec: 0.7, endSec: 0.9 },
            { text: 'there', startSec: 0.9, endSec: 1.1 },
            { text: 'are', startSec: 1.1, endSec: 1.3 },
            { text: 'a', startSec: 1.3, endSec: 1.4 },
            { text: 'lot', startSec: 1.4, endSec: 1.6 },
            { text: 'more', startSec: 1.6, endSec: 1.8 },
            { text: 'good', startSec: 1.8, endSec: 2.0 },
            { text: 'actors', startSec: 2.0, endSec: 2.3 },
            { text: 'than', startSec: 2.3, endSec: 2.5 },
            { text: 'the', startSec: 2.5, endSec: 2.7 },
            { text: 'other', startSec: 2.8, endSec: 3.1 },
          ],
          durationSeconds: 8,
        }}
      />,
    );
    const video = screen.getByTestId('job-file-player') as HTMLVideoElement;
    Object.defineProperty(video, 'currentTime', { configurable: true, get: () => 2.9 });
    video.dispatchEvent(new Event('timeupdate'));
    const caption = await screen.findByTestId('job-file-caption');
    expect(caption.querySelectorAll('.job-file-caption-line')).toHaveLength(2);
    expect(caption).toHaveTextContent('lot more good actors than the');
    expect(caption).toHaveTextContent('other');
    expect(caption).not.toHaveTextContent('but there');
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

  it('preloads the file and shows a spinner as soon as play is waiting on data', async () => {
    render(<JobFilePlayer src="https://signed.test/clip.mp4" poster="https://signed.test/thumb.jpg" />);
    const video = screen.getByTestId('job-file-player') as HTMLVideoElement;
    expect(video).toHaveAttribute('preload', 'auto');
    expect(video).toHaveAttribute('poster', 'https://signed.test/thumb.jpg');
    expect(screen.queryByTestId('job-file-buffer')).toBeNull();
    Object.defineProperty(video, 'paused', { configurable: true, get: () => false });
    Object.defineProperty(video, 'readyState', { configurable: true, get: () => 1 });
    video.dispatchEvent(new Event('play'));
    expect(await screen.findByTestId('job-file-buffer')).toBeInTheDocument();
    video.dispatchEvent(new Event('playing'));
    await waitFor(() => {
      expect(screen.queryByTestId('job-file-buffer')).toBeNull();
    });
  });

  it('asks the parent to remint when playback fails', () => {
    const onPlaybackError = vi.fn();
    render(<JobFilePlayer src="https://signed.test/clip.mp4" onPlaybackError={onPlaybackError} />);
    const video = screen.getByTestId('job-file-player') as HTMLVideoElement;
    Object.defineProperty(video, 'currentTime', { configurable: true, get: () => 4.2 });
    Object.defineProperty(video, 'paused', { configurable: true, get: () => false });
    video.dispatchEvent(new Event('error'));
    expect(onPlaybackError).toHaveBeenCalledWith({ currentTime: 4.2, wasPlaying: true });
    expect(screen.queryByTestId('job-file-play-error')).toBeNull();
  });

  it('shows a play error when nothing will remint the URL', async () => {
    render(<JobFilePlayer src="https://signed.test/expired.mp4" />);
    const video = screen.getByTestId('job-file-player') as HTMLVideoElement;
    video.dispatchEvent(new Event('error'));
    expect(await screen.findByTestId('job-file-play-error')).toHaveTextContent('Could not play this file');
  });
});
