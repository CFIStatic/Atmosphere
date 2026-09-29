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
    vi.mocked(api.approveIntake).mockReset();
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

  it('is the field app’s simple form: job name, optional note, Create job', async () => {
    render(
      <MemoryRouter>
        <JobIntakePage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Start a job' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /^Job name$/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Note/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Address' })).toBeNull();
    expect(screen.queryByPlaceholderText('Search Google for the site address')).toBeNull();

    // Invites are tucked behind a disclosure, closed by default.
    const people = screen.getByRole('button', { name: /Invite people/i });
    expect(people).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Marcus Webb')).toBeNull();
    expect(screen.queryByLabelText(/homeowner email/i)).toBeNull();

    expect(screen.getByRole('button', { name: 'Create job' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approve & invite/i })).toBeNull();
  });

  it('creates the job with nobody invited and goes straight to the job file', async () => {
    vi.mocked(api.approveIntake).mockResolvedValue(approveResult([]));

    const user = userEvent.setup();
    renderIntakeWithJobFile();

    await user.type(screen.getByRole('textbox', { name: /^Job name$/i }), 'East Racine');
    await user.type(
      screen.getByPlaceholderText(/Extract standing water/i),
      'Extract standing water in the living room.',
    );
    await user.click(screen.getByRole('button', { name: 'Create job' }));

    await expectOnNewJobFile();
    expect(api.approveIntake).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'East Racine', invitees: [] }),
    );
    expect(vi.mocked(api.approveIntake).mock.calls[0]?.[0]).not.toHaveProperty('address');
    expect(api.createProgressShare).not.toHaveBeenCalled();
  });

  it('switches to Create & send invites once a teammate is ticked', async () => {
    vi.mocked(api.approveIntake).mockResolvedValue(approveResult([MARCUS_INVITE]));

    const user = userEvent.setup();
    renderIntakeWithJobFile();

    await user.click(screen.getByRole('button', { name: /Invite people/i }));
    expect(await screen.findByText('Marcus Webb')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create job' })).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /Marcus Webb/i }));
    await user.type(screen.getByRole('textbox', { name: /^Job name$/i }), 'East Racine');
    await user.click(screen.getByRole('button', { name: 'Create & send invites' }));

    await expectOnNewJobFile();
    expect(api.approveIntake).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'East Racine',
        invitees: [expect.objectContaining({ userId: 'u-marcus', email: 'marcus@example.com' })],
      }),
    );
  });

  it('fits Start a job to the phone frame with the action pinned to the thumb', async () => {
    usePhoneShell.mockReturnValue(true);

    render(
      <MemoryRouter>
        <JobIntakePage />
      </MemoryRouter>,
    );

    const page = screen.getByTestId('start-job');
    expect(page.className).toMatch(/flex-1/);
    expect(screen.getByText('Name it, then start. A note and invites are optional.')).toBeInTheDocument();
    const create = screen.getByRole('button', { name: 'Create job' });
    expect(create.className).toMatch(/w-full/);
    expect(create.className).toMatch(/rounded-xl/);
  });

  it('adds an outside email onto the same invite list as teammates', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <JobIntakePage />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /Invite people/i }));
    expect(await screen.findByText('Marcus Webb')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Contact name'), 'Alex Rivera');
    await user.type(screen.getByLabelText('Company'), 'Rio Grande Mitigation');
    await user.type(screen.getByLabelText(/^Email$/i), 'alex@example.com');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(screen.getByText('Alex Rivera')).toBeInTheDocument();
    expect(screen.getByText('Rio Grande Mitigation · alex@example.com')).toBeInTheDocument();
    expect(screen.getAllByText(/^1 invited$/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Create & send invites' })).toBeInTheDocument();
  });

  it('previews what the homeowner will see once sharing is selected, then emails them', async () => {
    vi.mocked(api.approveIntake).mockResolvedValue(approveResult([]));

    const user = userEvent.setup();
    renderIntakeWithJobFile();

    await user.type(screen.getByRole('textbox', { name: /^Job name$/i }), 'East Racine');
    await user.click(screen.getByRole('button', { name: /Invite people/i }));
    expect(screen.queryByTestId('homeowner-disclosure')).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: /Share with the homeowner/i }));

    const disclosure = screen.getByTestId('homeowner-disclosure');
    expect(disclosure).toHaveTextContent('What the homeowner will see');
    expect(disclosure).toHaveTextContent('Every recording on this job, with its transcript and AI summary');
    expect(disclosure).toHaveTextContent(/revoke the link/i);

    await user.type(screen.getByLabelText(/homeowner email/i), 'jordan@example.com');
    expect(disclosure).toHaveTextContent('jordan@example.com gets an email');
    await user.click(screen.getByRole('button', { name: 'Create & send invites' }));

    await expectOnNewJobFile();
    expect(api.createProgressShare).toHaveBeenCalledWith({
      jobId: 'job-new',
      label: 'jordan@example.com',
      recipientEmail: 'jordan@example.com',
    });
  });

  it('asks for the homeowner email instead of creating a job that silently skips them', async () => {
    const user = userEvent.setup();
    renderIntakeWithJobFile();

    await user.type(screen.getByRole('textbox', { name: /^Job name$/i }), 'East Racine');
    await user.click(screen.getByRole('button', { name: /Invite people/i }));
    await user.click(screen.getByRole('checkbox', { name: /Share with the homeowner/i }));
    await user.click(screen.getByRole('button', { name: 'Create & send invites' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/homeowner’s email/);
    expect(api.approveIntake).not.toHaveBeenCalled();
  });

  it('still opens the job file when the homeowner link fails', async () => {
    vi.mocked(api.approveIntake).mockResolvedValue(approveResult([]));
    vi.mocked(api.createProgressShare).mockRejectedValue(new Error('mail down'));

    const user = userEvent.setup();
    renderIntakeWithJobFile();

    await user.type(screen.getByRole('textbox', { name: /^Job name$/i }), 'East Racine');
    await user.click(screen.getByRole('button', { name: /Invite people/i }));
    await user.click(screen.getByRole('checkbox', { name: /Share with the homeowner/i }));
    await user.type(screen.getByLabelText(/homeowner email/i), 'jordan@example.com');
    await user.click(screen.getByRole('button', { name: 'Create & send invites' }));

    await expectOnNewJobFile();
  });

  it('stays on Start a job and shows the error when create fails', async () => {
    vi.mocked(api.approveIntake).mockRejectedValue(new Error('Could not create the job.'));

    const user = userEvent.setup();
    renderIntakeWithJobFile();

    await user.type(screen.getByRole('textbox', { name: /^Job name$/i }), 'East Racine');
    await user.click(screen.getByRole('button', { name: 'Create job' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not create the job.');
    expect(screen.queryByRole('heading', { name: 'Job file' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Start a job' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create job' })).toBeEnabled();
  });
});
