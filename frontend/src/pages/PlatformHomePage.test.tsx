import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { JobSummary } from '../lib/api';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { email: 'casey@example.com' },
    profile: { fullName: 'Casey Ortiz' },
  }),
}));

const jobs: JobSummary[] = [
  {
    jobId: 'job-dated',
    jobNumber: 1041,
    title: 'Meridian Ave — water loss',
    status: 'in_progress',
    priority: 2,
    workType: 'mitigation',
    ownerId: 'u1',
    claimNumber: 'CLM-1',
    taskCount: 4,
    tasksDone: 1,
    crewSize: 2,
    minutesLogged: 60,
    eventCount: 3,
    lastEvent: 'Film uploaded',
    lastEventAt: new Date().toISOString(),
    contractAmount: 1000,
    invoicedAmount: 0,
    paidAmount: 0,
    scheduledStart: new Date().toISOString(),
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  },
  {
    jobId: 'job-open',
    jobNumber: 1044,
    title: 'East 6th — kitchen, water',
    status: 'draft',
    priority: 3,
    workType: 'mitigation',
    ownerId: 'u1',
    claimNumber: null,
    taskCount: 0,
    tasksDone: 0,
    crewSize: 1,
    minutesLogged: 0,
    eventCount: 0,
    lastEvent: null,
    lastEventAt: null,
    contractAmount: null,
    invoicedAmount: 0,
    paidAmount: 0,
    scheduledStart: null,
    createdAt: '2026-08-02T00:00:00Z',
    updatedAt: '2026-08-02T00:00:00Z',
  },
];

vi.mock('../lib/api', () => ({
  api: {
    getJobs: () => Promise.resolve({ jobs }),
  },
}));

import { PlatformHomePage } from './PlatformHomePage';

describe('PlatformHomePage', () => {
  it('lists every open job and does not say scheduled or unscheduled', async () => {
    render(
      <MemoryRouter>
        <PlatformHomePage platform="field" />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Open jobs')).toBeInTheDocument();
    });

    expect(screen.getByText('Worked today')).toBeInTheDocument();
    expect(screen.getByText('Active jobs')).toBeInTheDocument();
    expect(screen.getByText('Crew assigned')).toBeInTheDocument();
    expect(screen.queryByText('Scheduled today')).not.toBeInTheDocument();
    expect(screen.queryByText('Unscheduled')).not.toBeInTheDocument();

    expect(screen.getByText('Meridian Ave — water loss')).toBeInTheDocument();
    expect(screen.getByText('East 6th — kitchen, water')).toBeInTheDocument();
    expect(screen.getByText(/2 jobs ready to film/)).toBeInTheDocument();
  });
});
