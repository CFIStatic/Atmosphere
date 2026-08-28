import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobSummary } from '../lib/api';

vi.mock('../hooks/useFeatureTimer', () => ({
  useFeatureTimer: () => undefined,
}));

const getJobs = vi.fn();

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getJobs: (...args: unknown[]) => getJobs(...args),
    },
  };
});

import { JobsPage } from './JobsPage';

const jobs: JobSummary[] = [
  {
    jobId: 'job-1038',
    jobNumber: 1038,
    title: 'Cedar Ridge — storm damage',
    status: 'in_progress',
    priority: 2,
    workType: 'mitigation',
    ownerId: 'u1',
    claimNumber: 'CLM-1',
    taskCount: 4,
    tasksDone: 1,
    crewSize: 2,
    minutesLogged: 60,
    eventCount: 4,
    lastEvent: 'After clip read',
    lastEventAt: '2026-08-05T18:00:00Z',
    contractAmount: 18000,
    invoicedAmount: 0,
    paidAmount: 0,
    scheduledStart: null,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-05T18:00:00Z',
  },
];

function renderJobs() {
  return render(
    <MemoryRouter initialEntries={['/jobs']}>
      <Routes>
        <Route path="/jobs" element={<JobsPage />} />
        <Route path="/jobs/:id" element={<h1>Job profile</h1>} />
        <Route path="/intake" element={<h1>Start a job</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('JobsPage', () => {
  beforeEach(() => {
    getJobs.mockReset();
    getJobs.mockResolvedValue({ jobs });
  });

  it('lists jobs as cards that open the job profile', async () => {
    renderJobs();

    expect(await screen.findByRole('heading', { name: 'My jobs' })).toBeInTheDocument();
    expect(screen.getByText(/Every job file the office has opened/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Start a job/ })).toHaveAttribute('href', '/intake');
    expect(screen.queryByText('I forgot something — let me ask')).not.toBeInTheDocument();
    expect(screen.queryByText(/tasks/i)).not.toBeInTheDocument();
    const card = await screen.findByRole('link', { name: /Cedar Ridge/ });
    expect(card).toHaveAttribute('href', '/jobs/job-1038');
    expect(card).toHaveTextContent('4 clips on file');
    expect(screen.getAllByText('In progress').length).toBeGreaterThan(0);
  });

  it('searches jobs from the list', async () => {
    const user = userEvent.setup();
    renderJobs();
    await screen.findByRole('heading', { name: 'My jobs' });

    await user.type(screen.getByLabelText('Search job files'), 'Cedar');
    await waitFor(() => {
      expect(getJobs).toHaveBeenCalledWith(expect.objectContaining({ q: 'Cedar' }));
    });
  });
});
