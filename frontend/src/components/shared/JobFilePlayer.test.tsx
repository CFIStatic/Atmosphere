import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { VIDEO_PLAYER_PREFS_KEY } from '../../lib/videoPlayerPrefs';
import { JobFilePlayer } from './JobFilePlayer';

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
});
