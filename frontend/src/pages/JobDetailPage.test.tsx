import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job, ProofResponse, SharedJobRecord } from '../lib/api';

vi.mock('../hooks/useFeatureTimer', () => ({
  useFeatureTimer: () => undefined,
}));

const usePhoneShell = vi.fn(() => false);

vi.mock('../lib/usePhoneShell', () => ({
  usePhoneShell: () => usePhoneShell(),
}));

const getJob = vi.fn();
const sharedJob = vi.fn();
const jobProofs = vi.fn();
const proofQuestions = vi.fn();
const evidenceShares = vi.fn();

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getJob: (...args: unknown[]) => getJob(...args),
      sharedJob: (...args: unknown[]) => sharedJob(...args),
      jobProofs: (...args: unknown[]) => jobProofs(...args),
      proofQuestions: (...args: unknown[]) => proofQuestions(...args),
      evidenceShares: (...args: unknown[]) => evidenceShares(...args),
    },
  };
});

import { JobDetailPage } from './JobDetailPage';

const job: Job = {
  id: 'job-1038',
  jobNumber: 1038,
  title: 'Cedar Ridge — storm damage',
  description: null,
  workType: 'construction',
  lossType: null,
  status: 'in_progress',
  priority: 1,
  claimNumber: 'CLM-88396',
  policyNumber: null,
  ownerId: 'u1',
  contactId: null,
  accountId: null,
  propertyId: null,
  lossDate: null,
  scheduledStart: null,
  scheduledEnd: null,
  actualStart: null,
  actualEnd: null,
  contractAmount: null,
  invoicedAmount: null,
  paidAmount: null,
  createdBy: 'u1',
  createdAt: '2026-07-19T08:30:00Z',
  updatedAt: '2026-08-05T18:00:00Z',
};

const record: SharedJobRecord = {
  job: {
    id: 'job-1038',
    jobNumber: 1038,
    title: 'Cedar Ridge — storm damage',
    status: 'in_progress',
    claimNumber: 'CLM-88396',
  },
  brief: {
    id: 'b1',
    revision: 4,
    facts: { 'Site address': '2214 Cedar Ridge Dr, Round Rock TX' },
    note: 'Skylights removed from scope.',
  },
  revisions: [],
  currentRevision: 4,
  parties: [
    {
      id: 'pty-2',
      company: 'Delgado Roofing',
      trade: 'roofing',
      contactName: 'Hector Delgado',
      email: 'hector@example.com',
      phone: null,
      role: 'subcontractor',
      invited_at: '2026-07-19T10:00:00Z',
      last_seen_at: '2026-08-01T06:20:00Z',
      revoked_at: null,
      acknowledgedRevision: 3,
      clear: false,
      because: 'They accepted revision 3; the job is on 4.',
    },
  ],
  scope: [
    {
      id: 'sc-2',
      party_id: null,
      state: 'excluded',
      title: 'Do not remove the skylights',
      detail: null,
      amount: null,
      reason: 'Carrier declined them.',
      revision: 4,
      decided_at: null,
      created_at: '2026-08-04T08:05:00Z',
    },
  ],
  money: { approved: 0, pending: 0, unpricedApprovals: 0 },
  messages: [
    {
      id: 'm1',
      party_id: null,
      author_label: 'Homeowner',
      body: 'Please do not touch the skylights.',
      scope_item_id: 'sc-2',
      is_decision: false,
      created_at: '2026-08-03T09:12:00Z',
    },
  ],
  risks: [
    {
      key: 'stale:pty-2',
      level: 'blocker',
      title: 'Delgado Roofing accepted revision 3; the job is on 4',
      action: 'Get the new brief accepted before more work happens.',
      partyId: 'pty-2',
    },
  ],
};

const proofs: ProofResponse = {
  days: [],
  videos: [
    {
      id: 'p1',
      partyId: 'pty-2',
      company: 'Delgado Roofing',
      workDate: '2026-08-05',
      phase: 'after',
      durationSeconds: 94,
      analysisStatus: 'done',
      narrationStatus: 'done',
      transcriptStatus: 'done',
      transcriptError: null,
      aiSummary: 'The north slope is stripped to decking.',
      heardOnMic: 'Homeowner asked us not to touch the skylights.',
    },
  ],
  counts: { days: 0, videos: 1, payable: 0, contradicted: 0, awaitingAfter: 0 },
  siteKnown: true,
};

function renderJob() {
  return render(
    <MemoryRouter initialEntries={['/jobs/job-1038']}>
      <Routes>
        <Route path="/jobs/:id" element={<JobDetailPage />} />
        <Route path="/jobs" element={<h1>Job Files</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('JobDetailPage', () => {
  beforeEach(() => {
    localStorage.clear();
    usePhoneShell.mockReturnValue(false);
    getJob.mockReset();
    sharedJob.mockReset();
    jobProofs.mockReset();
    proofQuestions.mockReset();
    evidenceShares.mockReset();
    getJob.mockResolvedValue({ job, tasks: [], crew: [], workLogs: [], memory: [] });
    sharedJob.mockResolvedValue(record);
    jobProofs.mockResolvedValue(proofs);
    proofQuestions.mockResolvedValue({ questions: [] });
    evidenceShares.mockResolvedValue({ shares: [] });
  });

  it('is one file: film, do-not, blockers, and ask — not Work / Crew / History', async () => {
    renderJob();

    expect(await screen.findByRole('heading', { name: 'Cedar Ridge — storm damage' })).toBeInTheDocument();
    expect(screen.getByText('2214 Cedar Ridge Dr, Round Rock TX')).toBeInTheDocument();
    expect(screen.getByText('Clips on file')).toBeInTheDocument();
    expect(screen.getByText('Heard on mic')).toBeInTheDocument();
    expect(screen.getByText('Do not remove the skylights')).toBeInTheDocument();
    expect(
      screen.getByText('Delgado Roofing accepted revision 3; the job is on 4'),
    ).toBeInTheDocument();
    expect(screen.getByText('Delgado Roofing')).toBeInTheDocument();
    expect(screen.getByText('On an older brief')).toBeInTheDocument();
    const file = screen.getByTestId('job-file');
    expect(file.className).toMatch(/lg:flex-row/);
    const ask = await screen.findByTestId('job-file-ask');
    expect(ask).toHaveAttribute('aria-label', 'Ask this job');
    expect(ask.className).toMatch(/lg:h-full/);
    expect(ask.className).toMatch(/lg:w-\[min\(32rem,42%\)\]/);
    expect(ask).toContainElement(screen.getByRole('heading', { name: 'Ask this job' }));

    expect(screen.queryByRole('tab', { name: 'Work' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Crew' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'History' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Ask' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Legal hold' })).not.toBeInTheDocument();
    expect(screen.queryByText('Place this job on legal hold')).not.toBeInTheDocument();
    expect(screen.queryByText('Place on legal hold')).not.toBeInTheDocument();
    expect(screen.queryByText('Tasks')).not.toBeInTheDocument();
    expect(screen.queryByText('Logged')).not.toBeInTheDocument();
    expect(screen.queryByText('Add a task…')).not.toBeInTheDocument();

    await waitFor(() => {
      expect(getJob).toHaveBeenCalledWith('job-1038');
    });
    expect(JSON.parse(localStorage.getItem('atmosphere.jobFileOpenedAt') ?? '{}')['job-1038']).toEqual(
      expect.any(Number),
    );
  });

  it('uses File and Ask tabs on a phone so chat is not buried under the dossier', async () => {
    usePhoneShell.mockReturnValue(true);
    const user = userEvent.setup();
    renderJob();

    expect(await screen.findByRole('heading', { name: 'Cedar Ridge — storm damage' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'File' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Ask' })).toBeInTheDocument();
    expect(screen.getByTestId('job-file-ask')).toHaveAttribute('hidden');
    expect(screen.getByTestId('job-file-ask').className.split(/\s+/)).not.toContain('flex');
    expect(screen.queryByRole('heading', { name: 'Legal hold' })).not.toBeInTheDocument();
    expect(screen.queryByText('Place this job on legal hold')).not.toBeInTheDocument();
    expect(screen.queryByText('Place on legal hold')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Ask this job' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Ask' }));
    expect(await screen.findByRole('heading', { name: 'Ask this job' })).toBeInTheDocument();
    expect(screen.getByTestId('job-file-ask')).toHaveAttribute('aria-label', 'Ask this job');
  });

  it('shares the job file instead of showing a Scheduled status', async () => {
    getJob.mockResolvedValue({
      job: { ...job, status: 'scheduled' },
      tasks: [],
      crew: [],
      workLogs: [],
      memory: [],
    });
    const user = userEvent.setup();
    renderJob();

    expect(await screen.findByRole('heading', { name: 'Cedar Ridge — storm damage' })).toBeInTheDocument();
    expect(screen.queryByText('Scheduled')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Change job status')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Share this job file' }));
    expect(await screen.findByRole('heading', { name: 'Invite by email' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send invite/i })).toBeInTheDocument();
  });
});
