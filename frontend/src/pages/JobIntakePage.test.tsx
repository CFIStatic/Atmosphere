import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../hooks/useFeatureTimer', () => ({
  useFeatureTimer: () => undefined,
}));

vi.mock('../hooks/useExperiment', () => ({
  useExperiment: () => ({
    variantKey: null,
    loading: false,
    track: vi.fn(),
  }),
}));

const usePhoneShell = vi.fn(() => false);

vi.mock('../lib/usePhoneShell', () => ({
  usePhoneShell: () => usePhoneShell(),
}));

vi.mock('../lib/api', () => ({
  api: {
    getMembers: () =>
      Promise.resolve({
        members: [
          {
            userId: 'u-marcus',
            email: 'marcus@example.com',
            fullName: 'Marcus Webb',
            role: 'field_technician',
            workType: 'mitigation',
            usageIntents: ['field_work'],
            status: 'active',
          },
        ],
      }),
    approveIntake: vi.fn(),
    createProgressShare: vi.fn(),
  },
}));

import { api } from '../lib/api';
import { JobIntakePage } from './JobIntakePage';

function JobFileStub() {
  const location = useLocation();
  return (
    <>
      <h1>Job file</h1>
      <p data-testid="job-file-search">{location.search}</p>
    </>
  );
}

function renderIntakeWithJobFile() {
  return render(
    <MemoryRouter initialEntries={['/intake']}>
      <Routes>
        <Route path="/intake" element={<JobIntakePage />} />
        <Route path="/jobs/:id" element={<h1>Left intake</h1>} />
        <Route path="/job-progress" element={<JobFileStub />} />
      </Routes>
    </MemoryRouter>,
  );
}

function approveResult(invites: Awaited<ReturnType<typeof api.approveIntake>>['invites']) {
  return {
    job: { id: 'job-new', title: 'East Racine', jobNumber: 12 },
    briefRevision: 1,
    scopeSaved: 0,
    invites,
    party: { id: 'pty-1', company: 'Field Capture' },
    sharePath: '/shared/tok-1',
    fieldCapturePath: '/fieldcapture/?token=tok-1',
    readiness: {
      level: 'limited' as const,
      ceiling: 'work_only' as const,
      headline: 'Invite sent',
      gaps: [],
      strengths: [],
      source: null,
    },
  };
}

const MARCUS_INVITE = {
  id: 'inv-1',
  name: 'Marcus Webb',
  email: 'marcus@example.com',
  sharePath: '/shared/tok-1',
  fieldCapturePath: '/fieldcapture/?token=tok-1',
  token: 'tok-1',
  emailed: true,
  recipientHasAccount: true,
};

async function expectOnNewJobFile() {
  expect(await screen.findByRole('heading', { name: 'Job file' })).toBeInTheDocument();
  expect(screen.getByTestId('job-file-search').textContent).toBe(
    '?job=job-new&title=East+Racine&number=12',
  );
  expect(screen.queryByText(/Job created/)).toBeNull();
  expect(screen.queryByText('Film in Field Capture')).toBeNull();
  expect(screen.queryByText('Left intake')).toBeNull();
}

describe('JobIntakePage', () => {
  beforeEach(() => {
    document.title = 'Atmosphere';
    usePhoneShell.mockReturnValue(false);
    vi.mocked(api.createProgressShare).mockReset();
    vi.mocked(api.createProgressShare).mockResolvedValue({
      share: {
        id: 'hs-1',
        label: 'Homeowner',
        kind: 'progress',
        expiresAt: null,
        createdAt: '2026-08-31T00:00:00.000Z',
        path: '/progress/home-tok',
      },
      emailed: true,
      recipientHasAccount: false,
    });
  });

  it('puts name, situation, and invite list on one page without an address field', async () => {
    render(
      <MemoryRouter>
        <JobIntakePage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Start a job' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Name' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Address' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Situation' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Invite list' })).toBeInTheDocument();

    expect(screen.queryByText('1 · Address')).toBeNull();
    expect(screen.queryByText('2 · Review')).toBeNull();
    expect(screen.queryByText('Review before anyone sees it')).toBeNull();
    expect(screen.queryByText('Job title')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Next$/i })).toBeNull();
    expect(screen.queryByPlaceholderText('Search Google for the site address')).toBeNull();

    expect(await screen.findByText('Marcus Webb')).toBeInTheDocument();
    expect(screen.queryByText('Invite an outside worker')).toBeNull();
    expect(screen.getByText('Homeowner (optional)')).toBeInTheDocument();
    expect(
      screen.getByText(/We email them a link to the job file and every recording/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Approve & invite/i })).toBeInTheDocument();
  });

  it('goes straight to the new job file after approve — no confirmation screen', async () => {
    vi.mocked(api.approveIntake).mockResolvedValue(approveResult([MARCUS_INVITE]));

    const user = userEvent.setup();
    renderIntakeWithJobFile();

    expect(await screen.findByText('Marcus Webb')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: /^Name$/i }), 'East Racine');
    await user.click(screen.getByRole('button', { name: /Approve & invite/i }));

    await expectOnNewJobFile();
    expect(api.approveIntake).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'East Racine',
        invitees: [
          expect.objectContaining({ userId: 'u-marcus', email: 'marcus@example.com' }),
        ],
      }),
    );
    expect(vi.mocked(api.approveIntake).mock.calls[0]?.[0]).not.toHaveProperty('address');
  });

  it('fits Start a job to the phone frame instead of four desktop cards', async () => {
    usePhoneShell.mockReturnValue(true);

    render(
      <MemoryRouter>
        <JobIntakePage />
      </MemoryRouter>,
    );

    const page = screen.getByTestId('start-job');
    expect(page.className).toMatch(/flex-1/);
    expect(screen.getByRole('heading', { name: 'Start a job' })).toBeInTheDocument();
    expect(screen.getByText('Name it. A note and invites are optional.')).toBeInTheDocument();
    expect(
      screen.queryByText('Name the job, then the site. A short note and invites are optional.'),
    ).toBeNull();
    expect(screen.queryByText('What this job is called on the dashboard.')).toBeNull();
    expect(screen.queryByText('Where the crew will work.')).toBeNull();

    expect(screen.getByRole('heading', { name: 'Name' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Address' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Situation' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Invite list' })).toBeInTheDocument();

    expect(screen.getByRole('textbox', { name: /^Name$/i })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Search Google for the site address')).toBeNull();

    expect(await screen.findByText('Marcus Webb')).toBeInTheDocument();
    expect(screen.queryByText('Capture')).toBeNull();
    expect(
      screen.getByText('Teammates and outside emails go on this list. Optional.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Invite an outside worker')).toBeNull();

    const approve = screen.getByRole('button', { name: /Approve & invite/i });
    expect(approve.className).toMatch(/w-full/);
    expect(approve.className).toMatch(/rounded-xl/);
  });

  it('goes straight to the new job file after approve on the phone too', async () => {
    usePhoneShell.mockReturnValue(true);
    vi.mocked(api.approveIntake).mockResolvedValue(approveResult([MARCUS_INVITE]));

    const user = userEvent.setup();
    renderIntakeWithJobFile();

    expect(await screen.findByText('Marcus Webb')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: /^Name$/i }), 'East Racine');
    await user.click(screen.getByRole('button', { name: /Approve & invite/i }));

    await expectOnNewJobFile();
  });

  it('creates the job file when the name is filled and nobody is invited', async () => {
    vi.mocked(api.approveIntake).mockResolvedValue({
      ...approveResult([]),
      scopeSaved: 1,
      sharePath: '',
      fieldCapturePath: '',
    });

    const user = userEvent.setup();
    renderIntakeWithJobFile();

    expect(await screen.findByText('Marcus Webb')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    await user.type(screen.getByRole('textbox', { name: /^Name$/i }), 'East Racine');
    await user.type(
      screen.getByPlaceholderText(/Extract standing water/i),
      'Extract standing water in the living room.',
    );
    await user.click(screen.getByRole('button', { name: /Approve & invite/i }));

    await expectOnNewJobFile();
    expect(api.approveIntake).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'East Racine',
        invitees: [],
      }),
    );
  });

  it('adds an outside email onto the same invite list as teammates', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <JobIntakePage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Marcus Webb')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Contact name'), 'Alex Rivera');
    await user.type(screen.getByLabelText('Company'), 'Rio Grande Mitigation');
    await user.type(screen.getByLabelText(/^Email$/i), 'alex@example.com');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(screen.getByText('Alex Rivera')).toBeInTheDocument();
    expect(screen.getByText('Rio Grande Mitigation · alex@example.com')).toBeInTheDocument();
    expect(screen.getByText(/2 invited/)).toBeInTheDocument();
    expect(screen.getAllByRole('list')).toHaveLength(1);
  });

  it('emails the homeowner the job file after approve, then opens the job file', async () => {
    vi.mocked(api.approveIntake).mockResolvedValue(approveResult([]));

    const user = userEvent.setup();
    renderIntakeWithJobFile();

    await user.type(screen.getByRole('textbox', { name: /^Name$/i }), 'East Racine');
    await user.type(screen.getByLabelText(/homeowner email/i), 'jordan@example.com');
    await user.click(screen.getByRole('button', { name: /Approve & invite/i }));

    await expectOnNewJobFile();
    expect(api.createProgressShare).toHaveBeenCalledWith({
      jobId: 'job-new',
      label: 'jordan@example.com',
      recipientEmail: 'jordan@example.com',
    });
  });

  it('still opens the job file when the homeowner link fails', async () => {
    vi.mocked(api.approveIntake).mockResolvedValue(approveResult([]));
    vi.mocked(api.createProgressShare).mockRejectedValue(new Error('mail down'));

    const user = userEvent.setup();
    renderIntakeWithJobFile();

    await user.type(screen.getByRole('textbox', { name: /^Name$/i }), 'East Racine');
    await user.type(screen.getByLabelText(/homeowner email/i), 'jordan@example.com');
    await user.click(screen.getByRole('button', { name: /Approve & invite/i }));

    await expectOnNewJobFile();
  });

  it('stays on Start a job and shows the error when approve fails', async () => {
    vi.mocked(api.approveIntake).mockRejectedValue(new Error('Could not create the job.'));

    const user = userEvent.setup();
    renderIntakeWithJobFile();

    await user.type(screen.getByRole('textbox', { name: /^Name$/i }), 'East Racine');
    await user.click(screen.getByRole('button', { name: /Approve & invite/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not create the job.');
    expect(screen.queryByRole('heading', { name: 'Job file' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Start a job' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Approve & invite/i })).toBeEnabled();
  });
});
