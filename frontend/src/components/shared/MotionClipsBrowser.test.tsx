import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const motionClipsForJob = vi.fn();

vi.mock('../../lib/api', () => ({
  api: {
    motionClipsForJob: (...args: unknown[]) => motionClipsForJob(...args),
  },
}));

import { MotionClipsBrowser } from './MotionClipsBrowser';

describe('MotionClipsBrowser', () => {
  beforeEach(() => {
    motionClipsForJob.mockReset();
  });

  it('renders clips grouped by motion and filters', async () => {
    motionClipsForJob.mockResolvedValue({
      jobId: 'job-1',
      jobTitle: 'Demo',
      motion: null,
      totalClips: 2,
      types: [
        { motion: 'cut', action: 'cut', count: 1 },
        { motion: 'screw', action: 'fasten', count: 1 },
      ],
      buckets: [
        {
          motion: 'cut',
          action: 'cut',
          count: 1,
          clips: [
            {
              startSec: 10,
              endSec: 14,
              action: 'cut',
              motion: 'cut',
              description: 'Cutting OSB',
              toolLabel: 'saw',
              objectLabel: 'osb',
              materialLabel: null,
              room: 'attic',
              confidence: 0.9,
              source: 'ai_vision',
              durationInferred: false,
              proofId: 'p1',
              jobId: 'job-1',
              orgId: 'o1',
              workDate: '2026-09-01',
              phase: 'during',
            },
          ],
        },
        {
          motion: 'screw',
          action: 'fasten',
          count: 1,
          clips: [
            {
              startSec: 20,
              endSec: 24,
              action: 'fasten',
              motion: 'screw',
              description: 'Screwing hinge',
              toolLabel: 'driver',
              objectLabel: 'hinge',
              materialLabel: null,
              room: null,
              confidence: 0.85,
              source: 'ai_vision',
              durationInferred: false,
              proofId: 'p1',
              jobId: 'job-1',
              orgId: 'o1',
              workDate: '2026-09-01',
              phase: 'during',
            },
          ],
        },
      ],
      disclaimer: 'test',
    });

    const user = userEvent.setup();
    render(<MotionClipsBrowser jobId="job-1" />);
    expect(screen.getByTestId('motion-clips-browser')).toBeInTheDocument();
    await waitFor(() => expect(motionClipsForJob).toHaveBeenCalledWith('job-1'));
    expect(await screen.findByText('Cutting OSB')).toBeInTheDocument();
    expect(screen.getByText('Screwing hinge')).toBeInTheDocument();

    await user.click(screen.getByTestId('motion-filter-screw'));
    expect(screen.getByText('Screwing hinge')).toBeInTheDocument();
    expect(screen.queryByText('Cutting OSB')).not.toBeInTheDocument();
  });

  it('shows empty state when no clips', async () => {
    motionClipsForJob.mockResolvedValue({
      jobId: 'job-empty',
      totalClips: 0,
      types: [],
      buckets: [],
      motion: null,
      disclaimer: 'x',
    });
    render(<MotionClipsBrowser jobId="job-empty" />);
    expect(await screen.findByTestId('motion-clips-empty')).toBeInTheDocument();
  });
});
