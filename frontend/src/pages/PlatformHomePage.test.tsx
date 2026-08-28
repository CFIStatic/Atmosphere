import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { JobSummary, SharedJobSummary } from '../lib/api';

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
  {
    jobId: 'job-failed',
    jobNumber: 1038,
    title: 'Cedar Ridge — storm damage',
    status: 'in_progress',
    priority: 1,
    workType: 'construction',
    ownerId: 'u1',
    claimNumber: 'CLM-2',
    taskCount: 2,
    tasksDone: 0,
    crewSize: 2,
    minutesLogged: 10,
    eventCount: 4,
    lastEvent: 'Clip failed',
    lastEventAt: new Date().toISOString(),
    contractAmount: 0,
    invoicedAmount: 0,
    paidAmount: 0,
    scheduledStart: null,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  },
];

const shared: SharedJobSummary[] = [
  {
    jobId: 'job-dated',
    jobNumber: 1041,
    title: 'Meridian Ave — water loss',
    status: 'in_progress',
    parties: 1,
    currentRevision: 2,
    behind: 0,
    awaiting: 0,
    exclusions: 1,
  },
  {
    jobId: 'job-open',
    jobNumber: 1044,
    title: 'East 6th — kitchen, water',
    status: 'draft',
    parties: 0,
    currentRevision: null,
    behind: 0,
    awaiting: 0,
    exclusions: 0,
  },
  {
    jobId: 'job-failed',
    jobNumber: 1038,
    title: 'Cedar Ridge — storm damage',
    status: 'in_progress',
    parties: 3,
    currentRevision: 4,
    behind: 2,
    awaiting: 1,
    exclusions: 2,
  },
];

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return {
    ...actual,
    api: {
      getJobs: () => Promise.resolve({ jobs }),
      sharedJobs: () => Promise.resolve({ jobs: shared, counts: { jobs: 3, parties: 4, blockers: 2, awaiting: 1 } }),
      proofPulse: () =>
        Promise.resolve({
          clips: 8,
          read: 5,
          analysing: 1,
          failed: 2,
          unread: 1,
          heard: 3,
          filmedToday: 2,
          byJob: [
            {
              jobId: 'job-failed',
              clips: 4,
              read: 2,
              analysing: 0,
              failed: 2,
              unread: 0,
              heard: 2,
              filmedToday: 0,
            },
            {
              jobId: 'job-dated',
              clips: 4,
              read: 3,
              analysing: 1,
              failed: 0,
              unread: 1,
              heard: 1,
              filmedToday: 2,
            },
          ],
        }),
    },
  };
});

import { PlatformHomePage } from './PlatformHomePage';

describe('PlatformHomePage', () => {
  it('is a proof-chain decision queue, not a company inventory dashboard', async () => {
    render(
      <MemoryRouter>
        <PlatformHomePage platform="field" />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'What needs you' })).toBeInTheDocument();
    });

    expect(screen.getByText('Jobs where proof is stuck', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open My work' })).toHaveAttribute('href', '/my-work');
    expect(screen.getByText('Proof chain')).toBeInTheDocument();
    expect(screen.getByText('Do this next')).toBeInTheDocument();
    expect(screen.getByText("Today's film")).toBeInTheDocument();

    expect(screen.queryByText('Company overview')).not.toBeInTheDocument();
    expect(screen.queryByText('Active jobs')).not.toBeInTheDocument();
    expect(screen.queryByText('Crew assigned')).not.toBeInTheDocument();
    expect(screen.queryByText('Contracted')).not.toBeInTheDocument();
    expect(screen.queryByText('Outstanding')).not.toBeInTheDocument();
    expect(screen.queryByText('Across the business')).not.toBeInTheDocument();
    expect(screen.queryByText('Good to see you', { exact: false })).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Cedar Ridge — storm damage')).toBeInTheDocument();
    });

    expect(screen.getByText('2 clips failed')).toBeInTheDocument();
    expect(screen.getByText('The assistant could not read the film. A person has to look.')).toBeInTheDocument();
    expect(screen.getByText('1 question unanswered · 2 parties on an old brief · Marked urgent')).toBeInTheDocument();

    expect(screen.getByText('Meridian Ave — water loss')).toBeInTheDocument();
    expect(screen.getByText('1 clip waiting')).toBeInTheDocument();
    expect(screen.getByText('East 6th — kitchen, water')).toBeInTheDocument();
    expect(screen.getByText('No brief published')).toBeInTheDocument();

    const cedar = screen.getByText('Cedar Ridge — storm damage').closest('a');
    expect(cedar).toHaveAttribute('href', expect.stringContaining('/job-progress?job=job-failed'));
    const east = screen.getByText('East 6th — kitchen, water').closest('a');
    expect(east).toHaveAttribute('href', expect.stringContaining('/job-progress?job=job-open'));
    const meridian = screen.getByText('Meridian Ave — water loss').closest('a');
    expect(meridian).toHaveAttribute('href', expect.stringContaining('/job-progress?job=job-dated'));

    expect(screen.getByText('Waiting to be read')).toBeInTheDocument();
    expect(screen.queryByText('Scheduled today')).not.toBeInTheDocument();
  });

  it('lets the office filter the queue by proof-chain stage', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <PlatformHomePage platform="field" />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Cedar Ridge — storm damage')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /needs a brief/i }));
    expect(screen.getByText('East 6th — kitchen, water')).toBeInTheDocument();
    expect(screen.queryByText('Cedar Ridge — storm damage')).not.toBeInTheDocument();
    expect(screen.queryByText('Meridian Ave — water loss')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /needs a look/i }));
    expect(screen.getByText('Cedar Ridge — storm damage')).toBeInTheDocument();
    expect(screen.queryByText('East 6th — kitchen, water')).not.toBeInTheDocument();
  });
});
