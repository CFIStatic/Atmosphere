import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobSummary, ProofResponse, SharedJobRecord } from '../lib/api';

vi.mock('../hooks/useFeatureTimer', () => ({
  useFeatureTimer: () => undefined,
}));

const getJobs = vi.fn();
const sharedJob = vi.fn();
const jobProofs = vi.fn();
const proofQuestions = vi.fn();
const askAboutProofs = vi.fn();

vi.mock('../lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    getJobs: (...args: unknown[]) => getJobs(...args),
    sharedJob: (...args: unknown[]) => sharedJob(...args),
    jobProofs: (...args: unknown[]) => jobProofs(...args),
    proofQuestions: (...args: unknown[]) => proofQuestions(...args),
    askAboutProofs: (...args: unknown[]) => askAboutProofs(...args),
  },
}));

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
  },
];

const record: SharedJobRecord = {
  job: {
    id: 'job-1038',
    jobNumber: 1038,
    title: 'Cedar Ridge — storm damage',
    status: 'in_progress',
    claimNumber: 'CLM-1',
  },
  brief: {
    id: 'b1',
    revision: 1,
    facts: { 'Site address': '1408 Meridian Ave' },
    note: null,
  },
  revisions: [],
  currentRevision: 1,
  parties: [],
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
      </Routes>
    </MemoryRouter>,
  );
}

describe('JobsPage job file', () => {
  beforeEach(() => {
    getJobs.mockReset();
    sharedJob.mockReset();
    jobProofs.mockReset();
    proofQuestions.mockReset();
    askAboutProofs.mockReset();
    getJobs.mockResolvedValue({ jobs });
    sharedJob.mockResolvedValue(record);
    jobProofs.mockResolvedValue(proofs);
    proofQuestions.mockResolvedValue({ questions: [] });
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
    expect(screen.getAllByText(/1408 Meridian Ave/).length).toBeGreaterThan(0);
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
});
