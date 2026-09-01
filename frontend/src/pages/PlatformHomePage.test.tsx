import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobSummary, SharedJobSummary } from '../lib/api';
import { LIBRARY_CHANGED_EVENT } from '../lib/libraryChanged';

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

const pulse = {
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
};

const getJobs = vi.fn();
const sharedJobs = vi.fn();
const proofPulse = vi.fn();

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return {
    ...actual,
    api: {
      getJobs: (...args: unknown[]) => getJobs(...args),
      sharedJobs: (...args: unknown[]) => sharedJobs(...args),
      proofPulse: (...args: unknown[]) => proofPulse(...args),
    },
  };
});

import { PlatformHomePage } from './PlatformHomePage';

function renderOverview() {
  return render(
    <MemoryRouter>
      <PlatformHomePage platform="field" />
    </MemoryRouter>,
  );
}

describe('PlatformHomePage', () => {
  beforeEach(() => {
    getJobs.mockReset();
    sharedJobs.mockReset();
    proofPulse.mockReset();
    getJobs.mockResolvedValue({ jobs });
    sharedJobs.mockResolvedValue({
      jobs: shared,
      counts: { jobs: 3, parties: 4, blockers: 2, awaiting: 1 },
    });
    proofPulse.mockResolvedValue(pulse);
  });

  it('is a proof-chain decision queue, not a company inventory dashboard', async () => {
    renderOverview();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'What needs you' })).toBeInTheDocument();
    });

    expect(screen.getByText('Jobs where proof is stuck', { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open Field Capture' })).not.toBeInTheDocument();
    expect(screen.queryByText('My work')).not.toBeInTheDocument();
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
    expect(screen.getByTestId('proof-chain-grid')).toHaveClass('grid-cols-5');
  });

  it('fits the proof chain as a five-stage strip in the Field Capture frame', async () => {
    document.documentElement.dataset.fieldEmbed = '1';
    window.innerWidth = 390;

    try {
      renderOverview();

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'What needs you' })).toBeInTheDocument();
      });

      expect(
        screen.getByText('Proof stuck — unread film, briefs behind, unanswered questions.'),
      ).toBeInTheDocument();
      expect(screen.queryByText('Jobs where proof is stuck', { exact: false })).not.toBeInTheDocument();
      expect(screen.getByTestId('proof-chain-grid')).toHaveClass('grid-cols-5');
      expect(screen.getByRole('button', { name: 'Needs a brief' })).toBeInTheDocument();
      expect(screen.getByText('Brief')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Start a job' })).toBeInTheDocument();
      expect(screen.queryByText("Today's film")).not.toBeInTheDocument();
      expect(screen.queryByText('Who is on jobs')).not.toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByText('Cedar Ridge — storm damage')).toBeInTheDocument();
      });
      expect(screen.getByText('2 clips failed')).toBeInTheDocument();
      expect(
        screen.queryByText('The assistant could not read the film. A person has to look.'),
      ).not.toBeInTheDocument();
    } finally {
      delete document.documentElement.dataset.fieldEmbed;
      window.innerWidth = 1024;
    }
  });

  it('lets the office filter the queue by proof-chain stage', async () => {
    const user = userEvent.setup();
    renderOverview();

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

  it('hides a job file the Dashboard already deleted even when last event is older', async () => {
    getJobs.mockResolvedValue({
      jobs: [
        ...jobs,
        {
          ...jobs[0],
          jobId: 'cursor-1',
          jobNumber: 1,
          title: 'Cursor 1',
          lastEvent: 'opened job #1 — Cursor 1',
          lastEventAt: '2026-08-01T13:00:00Z',
        },
      ],
    });
    renderOverview();
    expect(await screen.findByText('Cedar Ridge — storm damage')).toBeInTheDocument();
    expect(screen.queryByText('Cursor 1')).not.toBeInTheDocument();
  });

  it('reloads the proof chain after a library delete', async () => {
    renderOverview();
    expect(await screen.findByText('Cedar Ridge — storm damage')).toBeInTheDocument();
    expect(screen.getByText('2 clips failed')).toBeInTheDocument();

    getJobs.mockResolvedValue({
      jobs: jobs.filter((job) => job.jobId !== 'job-failed'),
    });
    sharedJobs.mockResolvedValue({
      jobs: shared.filter((job) => job.jobId !== 'job-failed'),
      counts: { jobs: 2, parties: 1, blockers: 0, awaiting: 0 },
    });
    proofPulse.mockResolvedValue({
      ...pulse,
      clips: 4,
      failed: 0,
      byJob: pulse.byJob.filter((row) => row.jobId !== 'job-failed'),
    });

    window.dispatchEvent(new Event(LIBRARY_CHANGED_EVENT));

    await waitFor(() => {
      expect(screen.queryByText('Cedar Ridge — storm damage')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Meridian Ave — water loss')).toBeInTheDocument();
    expect(screen.queryByText('2 clips failed')).not.toBeInTheDocument();
    expect(getJobs).toHaveBeenCalledTimes(2);
  });
});
