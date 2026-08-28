import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobSummary, ProofResponse, SharedJobRecord } from '../lib/api';

vi.mock('../hooks/useFeatureTimer', () => ({
  useFeatureTimer: () => undefined,
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { email: 'dana@ortizrestoration.com' },
    profile: { fullName: 'Dana Ortiz', avatarUrl: null },
    membership: { org: { id: 'org-1', name: 'Ortiz Restoration Group', joinCode: '8F3A9C2B' } },
  }),
}));

const getJobs = vi.fn();
const sharedJob = vi.fn();
const jobProofs = vi.fn();
const proofQuestions = vi.fn();
const askAboutProofs = vi.fn();
const jobEvidence = vi.fn();
const evidenceShares = vi.fn();

vi.mock('../lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    getJobs: (...args: unknown[]) => getJobs(...args),
    sharedJob: (...args: unknown[]) => sharedJob(...args),
    jobProofs: (...args: unknown[]) => jobProofs(...args),
    proofQuestions: (...args: unknown[]) => proofQuestions(...args),
    askAboutProofs: (...args: unknown[]) => askAboutProofs(...args),
    jobEvidence: (...args: unknown[]) => jobEvidence(...args),
    evidenceShares: (...args: unknown[]) => evidenceShares(...args),
  },
}));

import { JobsPage } from './JobsPage';

const cedar: JobSummary = {
  jobId: 'job-1038',
  jobNumber: 1038,
  title: 'Cedar Ridge — storm damage',
  status: 'in_progress',
  priority: 2,
  workType: 'mitigation',
  ownerId: 'u1',
  claimNumber: 'CLM-88396',
  taskCount: 0,
  tasksDone: 0,
  crewSize: 2,
  minutesLogged: 0,
  eventCount: 4,
  lastEvent: 'After clip read',
  lastEventAt: '2026-08-05T18:00:00Z',
  contractAmount: 18000,
  invoicedAmount: 0,
  paidAmount: 0,
  scheduledStart: null,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-05T18:00:00Z',
};

const meridian: JobSummary = {
  ...cedar,
  jobId: 'job-1041',
  jobNumber: 1041,
  title: 'Meridian Ave — water loss, Class 3',
  claimNumber: 'CLM-88412',
  lastEvent: 'Moisture reading logged',
  lastEventAt: '2026-08-01T12:20:00Z',
  createdAt: '2026-07-24T15:02:00Z',
  updatedAt: '2026-08-01T12:20:00Z',
};

const jobs: JobSummary[] = [cedar, meridian];

const cedarRecord: SharedJobRecord = {
  job: {
    id: 'job-1038',
    jobNumber: 1038,
    title: 'Cedar Ridge — storm damage',
    status: 'in_progress',
    claimNumber: 'CLM-88396',
  },
  brief: {
    id: 'b1',
    revision: 1,
    facts: { 'Site address': '2214 Cedar Ridge Dr, Round Rock TX' },
    note: null,
  },
  revisions: [],
  currentRevision: 1,
  parties: [
    {
      id: 'pty-2',
      company: 'Delgado Roofing',
      trade: 'roofing',
      contactName: 'Hector Delgado',
      email: 'hector@delgadoroofing.example',
      phone: null,
      role: 'subcontractor',
      invited_at: null,
      last_seen_at: null,
      revoked_at: null,
      acknowledgedRevision: 3,
      clear: false,
      because: '',
    },
  ],
  scope: [],
  money: { approved: 0, pending: 0, unpricedApprovals: 0 },
  messages: [
    {
      id: 'm1',
      party_id: null,
      author_label: 'Homeowner',
      body: 'Please do not touch the skylights.',
      scope_item_id: null,
      is_decision: false,
      created_at: '2026-08-04T10:00:00Z',
    },
  ],
  risks: [],
};

const meridianRecord: SharedJobRecord = {
  ...cedarRecord,
  job: {
    id: 'job-1041',
    jobNumber: 1041,
    title: 'Meridian Ave — water loss, Class 3',
    status: 'in_progress',
    claimNumber: 'CLM-88412',
  },
  brief: {
    id: 'b2',
    revision: 1,
    facts: { 'Site address': '1408 Meridian Ave, Austin TX' },
    note: null,
  },
  parties: [],
  messages: [],
};

const proofs: ProofResponse = {
  days: [],
  videos: [
    {
      id: 'p1',
      partyId: 'pty-1',
      company: 'Delgado Roofing',
      workDate: '2026-08-05',
      phase: 'after',
      durationSeconds: 143,
      analysisStatus: 'done',
      narrationStatus: 'done',
      transcriptStatus: 'done',
      transcriptError: null,
      aiSummary: 'The tarp is gone from the north slope.',
      heardOnMic: 'Homeowner asked us not to touch the skylights.',
    },
  ],
  counts: { days: 0, videos: 1, payable: 0, contradicted: 0, awaitingAfter: 0 },
  siteKnown: true,
};

function renderJobs(path = '/jobs') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/jobs" element={<JobsPage />} />
        <Route path="/job-progress" element={<div>Scope of work</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function searchReady() {
  await waitFor(() => {
    expect(jobEvidence).toHaveBeenCalled();
  });
}

describe('JobsPage job file', () => {
  beforeEach(() => {
    getJobs.mockReset();
    sharedJob.mockReset();
    jobProofs.mockReset();
    proofQuestions.mockReset();
    askAboutProofs.mockReset();
    jobEvidence.mockReset();
    evidenceShares.mockReset();
    getJobs.mockResolvedValue({ jobs });
    sharedJob.mockImplementation(async (id: string) => (id === 'job-1041' ? meridianRecord : cedarRecord));
    jobProofs.mockImplementation(async (id: string) =>
      id === 'job-1038' ? proofs : { ...proofs, videos: [], counts: { ...proofs.counts, videos: 0 } },
    );
    proofQuestions.mockResolvedValue({ questions: [] });
    jobEvidence.mockImplementation(async (id: string) =>
      id === 'job-1038'
        ? {
            items: [
              {
                id: 'pf-1',
                company: 'Delgado Roofing',
                contentHash: '4f2a9c1d8b73e5460af1c92d7e3b8054916cfa2d7b04e8135ca6dfe27093b118',
                workDate: '2026-08-05',
              },
            ],
          }
        : { items: [] },
    );
    evidenceShares.mockResolvedValue({
      shares: [{ id: 'vs-1', jobId: 'job-1038', path: '/verifier/shared/demo-rhodes' }],
    });
    askAboutProofs.mockResolvedValue({
      answer: 'Yes. The homeowner asked that the skylights be left alone.',
      groundedOn: 1,
      question: {
        id: 'q1',
        question: 'What did the homeowner say?',
        answer: 'Yes. The homeowner asked that the skylights be left alone.',
        grounded_on: ['2026-08-05:after'],
        created_at: '2026-08-06T12:00:00Z',
      },
    });
  });

  it('is a job file you ask, not a restoration dashboard', async () => {
    renderJobs();

    expect(await screen.findByText('I forgot something — let me ask')).toBeInTheDocument();
    expect(screen.getAllByText('Cedar Ridge — storm damage').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /open a job/i })).not.toBeInTheDocument();
    expect(screen.queryByText('In progress')).not.toBeInTheDocument();
    expect(screen.queryByText(/tasks/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/on crew/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Already in this file')).not.toBeInTheDocument();
    expect(screen.queryByText(/After clip read/i)).not.toBeInTheDocument();
  });

  it('shows the signed-in person and a find-a-file search in the header', async () => {
    renderJobs();

    expect(await screen.findByPlaceholderText('Search by job, company, date, address, ID, or hash')).toBeInTheDocument();
    expect(screen.getByText('Dana Ortiz')).toBeInTheDocument();
    expect(screen.getByText('Ortiz Restoration Group')).toBeInTheDocument();
    expect(screen.getByText('DO')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /switch to .* mode/i })).toBeInTheDocument();
    expect(screen.queryByText('Pick a file, or just ask')).not.toBeInTheDocument();
  });

  it('opens a file and answers from the video analysis', async () => {
    const user = userEvent.setup();
    renderJobs();

    await user.click(await screen.findByRole('button', { name: 'Ask about Cedar Ridge — storm damage' }));

    expect(
      await screen.findByText(/I've already read 1 clip and what was said on the mic/i),
    ).toBeInTheDocument();
    expect(screen.queryByText('Already in this file')).not.toBeInTheDocument();
    expect(screen.queryByText('Please do not touch the skylights.')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'What did the homeowner say about the skylights?' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'What did the homeowner say about the skylights?' }));

    await waitFor(() => {
      expect(askAboutProofs).toHaveBeenCalledWith(
        'job-1038',
        'What did the homeowner say about the skylights?',
      );
    });
    expect(
      await screen.findByText('Yes. The homeowner asked that the skylights be left alone.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/From 1 clip on this file/)).toBeInTheDocument();
  });

  it('deep-links a job file from ?job=', async () => {
    renderJobs('/jobs?job=job-1038');
    expect(await screen.findByRole('heading', { name: 'Cedar Ridge — storm damage' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Scope & proofs' })).toHaveAttribute(
      'href',
      '/job-progress?job=job-1038',
    );
  });

  it('finds a job file from the chat box', async () => {
    const user = userEvent.setup();
    renderJobs();

    expect((await screen.findAllByText('Cedar Ridge — storm damage')).length).toBeGreaterThan(0);
    await user.type(screen.getByPlaceholderText('Name the job you forgot something about…'), 'Cedar');
    await user.click(screen.getByRole('button', { name: 'Find a job file' }));

    expect(await screen.findByRole('heading', { name: 'Cedar Ridge — storm damage' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'What did the homeowner say about the skylights?' })).toBeInTheDocument();
  });

  it('filters files live from the header search and opens a unique match', async () => {
    const user = userEvent.setup();
    renderJobs();

    const search = await screen.findByTestId('job-file-search');
    expect(await screen.findByRole('button', { name: 'Ask about Meridian Ave — water loss, Class 3' })).toBeInTheDocument();

    await user.type(search, 'Cedar');
    expect(screen.queryByRole('button', { name: 'Ask about Meridian Ave — water loss, Class 3' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask about Cedar Ridge — storm damage' })).toBeInTheDocument();

    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { name: 'Cedar Ridge — storm damage' })).toBeInTheDocument();
  });

  it('finds Cedar Ridge by address, job number, company, date, and hash', async () => {
    const user = userEvent.setup();
    renderJobs();
    await searchReady();
    const search = screen.getByTestId('job-file-search');

    await user.clear(search);
    await user.type(search, '2214 Cedar Ridge');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Ask about Cedar Ridge — storm damage' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Ask about Meridian Ave — water loss, Class 3' })).not.toBeInTheDocument();
    });

    await user.clear(search);
    await user.type(search, '1038');
    expect(screen.getByRole('button', { name: 'Ask about Cedar Ridge — storm damage' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ask about Meridian Ave — water loss, Class 3' })).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'Delgado');
    expect(screen.getByRole('button', { name: 'Ask about Cedar Ridge — storm damage' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ask about Meridian Ave — water loss, Class 3' })).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, '2026-08-05');
    expect(screen.getByRole('button', { name: 'Ask about Cedar Ridge — storm damage' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ask about Meridian Ave — water loss, Class 3' })).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, '4f2a9c1d');
    expect(screen.getByRole('button', { name: 'Ask about Cedar Ridge — storm damage' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ask about Meridian Ave — water loss, Class 3' })).not.toBeInTheDocument();

    await user.clear(search);
    expect(screen.getByRole('button', { name: 'Ask about Cedar Ridge — storm damage' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask about Meridian Ave — water loss, Class 3' })).toBeInTheDocument();
  });
});
