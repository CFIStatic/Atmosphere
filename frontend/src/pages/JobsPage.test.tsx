import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobSummary } from '../lib/api';
import { DashboardSearchBar } from '../components/DashboardSearchBar';
import { JobFilesSearchContext } from '../layouts/jobFilesSearch';
import { touchJobFile } from '../lib/jobFileRecents';

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

function JobFilesHarness() {
  const [query, setQuery] = useState('');
  return (
    <JobFilesSearchContext.Provider value={{ query, setQuery }}>
      <DashboardSearchBar value={query} onChange={setQuery} aria-label="Search job files" />
      <JobsPage />
    </JobFilesSearchContext.Provider>
  );
}

function renderJobs() {
  return render(
    <MemoryRouter initialEntries={['/jobs']}>
      <Routes>
        <Route path="/jobs" element={<JobFilesHarness />} />
        <Route path="/job-progress" element={<h1>Job file</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('JobsPage', () => {
  beforeEach(() => {
    localStorage.clear();
    getJobs.mockReset();
    getJobs.mockResolvedValue({ jobs });
  });

  it('lists job cards without a job number, title, create button, or status filters', async () => {
    renderJobs();

    expect(await screen.findByRole('link', { name: /Cedar Ridge/ })).toHaveAttribute(
      'href',
      expect.stringContaining('/job-progress?job=job-1038'),
    );
    expect(screen.getByRole('link', { name: /Harbor Point/ })).toBeInTheDocument();
    expect(screen.queryByText('#1038')).not.toBeInTheDocument();
    expect(screen.queryByText('#1042')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search by job, company, date, address, ID, or hash')).toBeInTheDocument();

    expect(screen.queryByRole('heading', { name: 'Jobs' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Job Files' })).not.toBeInTheDocument();
    expect(
      screen.queryByText('Every job the organization has opened. Each one carries its own complete history.'),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /open a job/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'In progress' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Scheduled' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'On hold' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Completed' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'All' })).not.toBeInTheDocument();
    expect(screen.queryByText('Scheduled')).not.toBeInTheDocument();
  });

  it('searches job files from the dashboard search bar', async () => {
    const user = userEvent.setup();
    renderJobs();
    expect(await screen.findByRole('link', { name: /Harbor Point/ })).toBeInTheDocument();

    await user.type(screen.getByLabelText('Search job files'), 'Cedar');
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Cedar Ridge/ })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /Harbor Point/ })).not.toBeInTheDocument();
    });
    expect(getJobs).toHaveBeenCalledWith({ status: 'all' });
  });

  it('ranks job files by last recorded event, then last clicked', async () => {
    getJobs.mockResolvedValue({ jobs: [jobs[1], jobs[0]] });
    const firstView = renderJobs();

    const first = await screen.findAllByRole('link');
    expect(first[0]).toHaveTextContent('Cedar Ridge');
    expect(first[1]).toHaveTextContent('Harbor Point');
    firstView.unmount();

    touchJobFile('job-1042', Date.parse('2026-08-22T12:00:00Z'));
    renderJobs();

    const ranked = await screen.findAllByRole('link');
    expect(ranked[0]).toHaveTextContent('Harbor Point');
    expect(ranked[1]).toHaveTextContent('Cedar Ridge');
  });
});
