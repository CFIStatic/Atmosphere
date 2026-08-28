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
  {
    jobId: 'job-1042',
    jobNumber: 1042,
    title: 'Harbor Point Condos — mold remediation',
    status: 'scheduled',
    priority: 3,
    workType: 'mitigation',
    ownerId: 'u1',
    claimNumber: null,
    taskCount: 2,
    tasksDone: 0,
    crewSize: 1,
    minutesLogged: 0,
    eventCount: 1,
    lastEvent: 'Containment plan drafted',
    lastEventAt: '2026-07-31T16:44:00Z',
    contractAmount: 9200,
    invoicedAmount: 0,
    paidAmount: 0,
    scheduledStart: '2026-08-02T14:00:00Z',
    createdAt: '2026-07-30T11:15:00Z',
    updatedAt: '2026-07-31T16:44:00Z',
  },
];

function renderJobs() {
  return render(
    <MemoryRouter initialEntries={['/jobs']}>
      <Routes>
        <Route path="/jobs" element={<JobsPage />} />
        <Route path="/jobs/:id" element={<h1>Job profile</h1>} />
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

    expect(await screen.findByRole('heading', { name: 'Job Files' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /open a job/i })).not.toBeInTheDocument();
    expect(screen.queryByText('I forgot something — let me ask')).not.toBeInTheDocument();
    const card = await screen.findByRole('link', { name: /Cedar Ridge/ });
    expect(card).toHaveAttribute('href', '/jobs/job-1038');
    expect(screen.getAllByText('In progress').length).toBeGreaterThan(0);
    expect(await screen.findByRole('link', { name: /Harbor Point/ })).toBeInTheDocument();
    expect(screen.queryByText('Scheduled')).not.toBeInTheDocument();
  });

  it('searches job files from the list', async () => {
    const user = userEvent.setup();
    renderJobs();
    await screen.findByRole('heading', { name: 'Job Files' });
    expect(await screen.findByRole('link', { name: /Harbor Point/ })).toBeInTheDocument();

    await user.type(screen.getByLabelText('Search job files'), 'Cedar');
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Cedar Ridge/ })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /Harbor Point/ })).not.toBeInTheDocument();
    });
    expect(getJobs).toHaveBeenCalledWith({ status: 'open' });
  });
});
