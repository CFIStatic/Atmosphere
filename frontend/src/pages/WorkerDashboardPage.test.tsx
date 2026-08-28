import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { FieldTodayJob, JobSummary } from '../lib/api';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-marcus', email: 'marcus@example.com' },
    profile: { fullName: 'Marcus Webb' },
    membership: {
      role: 'field_technician',
      org: { name: 'Ortiz Restoration' },
    },
  }),
}));

vi.mock('../hooks/useFeatureTimer', () => ({
  useFeatureTimer: () => undefined,
}));

const today: FieldTodayJob[] = [
  {
    id: 'job-1041',
    number: '#1041',
    name: 'Meridian Ave — water loss',
    address: '412 Meridian Ave',
    at: '8:00 AM',
    status: 'in_progress',
    placed: true,
    filmed: false,
    reason: 'in_progress',
    sharePath: '/shared/tok-1',
  },
];

const jobs: JobSummary[] = [
  {
    jobId: 'job-1041',
    jobNumber: 1041,
    title: 'Meridian Ave — water loss',
    status: 'in_progress',
    priority: 2,
    workType: 'mitigation',
    ownerId: 'u1',
    claimNumber: null,
    taskCount: 2,
    tasksDone: 0,
    crewSize: 1,
    minutesLogged: 0,
    eventCount: 1,
    lastEvent: 'On site',
    lastEventAt: new Date().toISOString(),
    contractAmount: null,
    invoicedAmount: 0,
    paidAmount: 0,
    scheduledStart: null,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    crew: [{ userId: 'u-marcus', name: 'Marcus Webb' }],
  },
];

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return {
    ...actual,
    api: {
      getJobs: () => Promise.resolve({ jobs }),
      fieldToday: () => Promise.resolve({ jobs: today, today: '2026-08-28' }),
    },
  };
});

import { WorkerDashboardPage } from './WorkerDashboardPage';

describe('WorkerDashboardPage', () => {
  it('shows this worker the jobs they are on, with a film button', async () => {
    render(
      <MemoryRouter>
        <WorkerDashboardPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Meridian Ave — water loss')).toBeInTheDocument();
    });

    expect(screen.getByTestId('worker-dashboard')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Hi, Marcus' })).toBeInTheDocument();
    expect(screen.getByText('412 Meridian Ave')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Film the day' })).toHaveAttribute(
      'href',
      '/shared/tok-1',
    );
    expect(screen.getByRole('link', { name: 'Company' })).toHaveAttribute('href', '/field');
    expect(screen.getByRole('navigation', { name: 'Worker app' })).toBeInTheDocument();
  });
});
