import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sharedJobs = vi.fn();
const sharedJob = vi.fn();
const renameJobFile = vi.fn();
const duplicateJobFile = vi.fn();
const deleteJobFile = vi.fn();

vi.mock('../hooks/useFeatureTimer', () => ({
  useFeatureTimer: () => undefined,
}));

const usePhoneShell = vi.fn(() => false);

vi.mock('../lib/usePhoneShell', () => ({
  usePhoneShell: () => usePhoneShell(),
}));

vi.mock('../components/JobAskPanel', () => ({
  JobAskPanel: () => <h2>Ask this job</h2>,
}));

vi.mock('../components/shared/JobProgressDashboard', () => ({
  JobProgressDashboard: () => <div>Job progress</div>,
}));

vi.mock('../components/shared/EvidenceLocker', () => ({
  EvidenceLocker: () => <div>Evidence locker</div>,
}));

vi.mock('../components/shared/ProofOfWork', () => ({
  ProofOfWork: ({ heading }: { heading?: string }) => (
    <section>{heading ?? 'Proof of work'}</section>
  ),
}));

vi.mock('../components/shared/JobReadinessPanel', () => ({
  JobReadinessPanel: () => null,
}));

vi.mock('../components/shared/ScopeDocPanel', () => ({
  ScopeDocPanel: () => null,
}));

vi.mock('../lib/api', () => ({
  api: {
    sharedJobs: (...args: unknown[]) => sharedJobs(...args),
    sharedJob: (...args: unknown[]) => sharedJob(...args),
    renameJobFile: (...args: unknown[]) => renameJobFile(...args),
    duplicateJobFile: (...args: unknown[]) => duplicateJobFile(...args),
    deleteJobFile: (...args: unknown[]) => deleteJobFile(...args),
  },
}));

import { SharedDashboardPage } from './SharedDashboardPage';

const summary = {
  jobId: 'job-1038',
  jobNumber: 1038,
  title: 'Cedar Ridge — storm damage',
  status: 'in_progress',
  parties: 1,
  currentRevision: 1,
  behind: 0,
  awaiting: 0,
  exclusions: 0,
};

const record = {
  job: {
    id: 'job-1038',
    jobNumber: 1038,
    title: 'Cedar Ridge — storm damage',
    status: 'in_progress',
    claimNumber: 'CLM-1',
  },
  brief: null,
  revisions: [],
  currentRevision: 1,
  parties: [],
  scope: [],
  money: { approved: 0, pending: 0, unpricedApprovals: 0 },
  messages: [],
  risks: [],
};

describe('SharedDashboardPage job file identity', () => {
  beforeEach(() => {
    localStorage.clear();
    usePhoneShell.mockReturnValue(false);
    sharedJobs.mockReset();
    sharedJob.mockReset();
    renameJobFile.mockReset();
    duplicateJobFile.mockReset();
    deleteJobFile.mockReset();
    deleteJobFile.mockResolvedValue({ ok: true, deletedAt: '2026-08-31T00:00:00Z', jobId: 'job-1038' });
    sharedJobs.mockResolvedValue({
      jobs: [summary],
      counts: { jobs: 1, parties: 0, blockers: 0, awaiting: 0 },
    });
    sharedJob.mockResolvedValue(record);
    renameJobFile.mockResolvedValue({
      job: { ...record.job, title: 'Cedar Ridge kitchen rebuild' },
    });
    duplicateJobFile.mockResolvedValue({
      job: { id: 'job-2', title: 'Copy of Cedar Ridge kitchen rebuild', jobNumber: 1099 },
      briefRevision: 1,
      scopeSaved: 0,
      jobFile: {
        ...summary,
        jobId: 'job-2',
        jobNumber: 1099,
        title: 'Copy of Cedar Ridge kitchen rebuild',
      },
    });
  });

  it('renames the open job file from the header', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/job-progress?job=job-1038']}>
        <SharedDashboardPage />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Cedar Ridge — storm damage' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Videos and analysis')).toBeInTheDocument();
    expect(screen.getByText('Evidence locker')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Legal hold' })).not.toBeInTheDocument();
    expect(screen.queryByText('Place this job on legal hold')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duplicate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const field = screen.getByLabelText(/^Name$/i);
    await user.clear(field);
    await user.type(field, 'Cedar Ridge kitchen rebuild');
    await user.click(screen.getByRole('button', { name: 'Save name' }));

    await waitFor(() => {
      expect(renameJobFile).toHaveBeenCalledWith('job-1038', 'Cedar Ridge kitchen rebuild');
    });
    expect(
      await screen.findByRole('heading', { name: 'Cedar Ridge kitchen rebuild' }),
    ).toBeInTheDocument();
  });

  it('pins Ask on the job file so Dashboard and Job Files share the same chat', async () => {
    render(
      <MemoryRouter initialEntries={['/job-progress?job=job-1038']}>
        <SharedDashboardPage />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Cedar Ridge — storm damage' }),
    ).toBeInTheDocument();
    const ask = screen.getByTestId('job-file-ask');
    expect(ask).toHaveAttribute('aria-label', 'Ask this job');
    expect(ask.className).toMatch(/lg:h-full/);
    expect(ask.className).toMatch(/lg:w-\[min\(32rem,42%\)\]/);
    expect(ask).toContainElement(screen.getByRole('heading', { name: 'Ask this job' }));
    expect(screen.queryByRole('tab', { name: 'Ask' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Dashboard/ })).toBeInTheDocument();
    expect(
      JSON.parse(localStorage.getItem('atmosphere.jobFileOpenedAt') ?? '{}')['job-1038'],
    ).toEqual(expect.any(Number));
  });

  it('uses File and Ask tabs on a phone so chat is not buried under the file', async () => {
    usePhoneShell.mockReturnValue(true);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/job-progress?job=job-1038']}>
        <SharedDashboardPage />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Cedar Ridge — storm damage' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'File' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Ask' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Ask this job' })).not.toBeInTheDocument();
    const ask = screen.getByTestId('job-file-ask');
    expect(ask).toHaveAttribute('hidden');
    expect(ask.className.split(/\s+/)).not.toContain('flex');
    expect(ask.className).toMatch(/data-\[state=active\]:flex/);

    await user.click(screen.getByRole('tab', { name: 'Ask' }));
    expect(await screen.findByRole('heading', { name: 'Ask this job' })).toBeInTheDocument();
    expect(screen.getByTestId('job-file-ask')).toHaveAttribute('aria-label', 'Ask this job');
  });
});
