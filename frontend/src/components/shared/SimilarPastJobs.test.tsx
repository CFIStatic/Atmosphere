import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const similarPastJobs = vi.fn();

vi.mock('../../lib/api', () => ({
  api: {
    similarPastJobs: (...args: unknown[]) => similarPastJobs(...args),
  },
}));

import { SimilarPastJobs } from './SimilarPastJobs';

describe('SimilarPastJobs', () => {
  beforeEach(() => {
    similarPastJobs.mockReset();
    similarPastJobs.mockResolvedValue({
      jobId: 'job-1',
      compared: 2,
      matches: [
        {
          jobId: 'job-2',
          title: 'Lakeview kitchen flood',
          jobNumber: 1042,
          workType: 'mitigation',
          status: 'completed',
          score: 0.72,
          reasons: ['Same work type (mitigation)', 'Rooms: kitchen'],
          trades: ['water mitigation'],
          rooms: ['kitchen'],
          sharedTrades: ['water mitigation'],
          sharedRooms: ['kitchen'],
          textSimilarity: 0.55,
        },
      ],
    });
  });

  it('lists similar jobs with links', async () => {
    render(
      <MemoryRouter>
        <SimilarPastJobs jobId="job-1" />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('similar-past-jobs')).toBeInTheDocument();
    await waitFor(() => {
      expect(similarPastJobs).toHaveBeenCalledWith('job-1');
    });
    const link = await screen.findByTestId('similar-job-link-job-2');
    expect(link).toHaveAttribute('href', expect.stringContaining('job=job-2'));
    expect(link).toHaveTextContent('Lakeview kitchen flood');
    expect(screen.getByText(/72% match/i)).toBeInTheDocument();
  });

  it('shows empty state when nothing matches', async () => {
    similarPastJobs.mockResolvedValue({ jobId: 'job-empty', compared: 0, matches: [] });
    render(
      <MemoryRouter>
        <SimilarPastJobs jobId="job-empty" />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/No close matches yet/i)).toBeInTheDocument();
  });
});
