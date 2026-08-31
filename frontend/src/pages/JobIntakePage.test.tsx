import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
    placesStatus: () => Promise.resolve({ configured: false }),
    approveIntake: vi.fn(),
    createProgressShare: vi.fn(),
  },
}));

import { api } from '../lib/api';
import { JobIntakePage } from './JobIntakePage';

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

  it('puts name, address, situation, and invite list on one page', async () => {
    render(
      <MemoryRouter>
        <JobIntakePage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Start a job' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Name' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Address' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Situation' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Invite list' })).toBeInTheDocument();

    expect(screen.queryByText('1 · Address')).toBeNull();
    expect(screen.queryByText('2 · Review')).toBeNull();
    expect(screen.queryByText('Review before anyone sees it')).toBeNull();
    expect(screen.queryByText('Job title')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Next$/i })).toBeNull();

    const nameField = screen.getByRole('textbox', { name: /^Name$/i });
    const addressField = screen.getByRole('combobox', { name: /^Address$/i });
    expect(nameField.compareDocumentPosition(addressField)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    expect(await screen.findByText('Marcus Webb')).toBeInTheDocument();
    expect(screen.getByText('Homeowner (optional)')).toBeInTheDocument();
    expect(
      screen.getByText(/We email them a link to the job file and every recording/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Approve & invite/i })).toBeInTheDocument();
  });

  it('stays on intake after approve so the invite link can be copied', async () => {
    vi.mocked(api.approveIntake).mockResolvedValue({
      job: { id: 'job-new', title: 'East Racine', jobNumber: 12 },
      briefRevision: 1,
      scopeSaved: 0,
      invites: [
        {
          id: 'inv-1',
          name: 'Marcus Webb',
          email: 'marcus@example.com',
          sharePath: '/shared/tok-1',
          fieldCapturePath: '/fieldcapture/?token=tok-1',
          token: 'tok-1',
          emailed: false,
        },
      ],
      party: { id: 'pty-1', company: 'Field Capture' },
      sharePath: '/shared/tok-1',
      fieldCapturePath: '/fieldcapture/?token=tok-1',
      readiness: {
        level: 'limited',
        ceiling: 'work_only',
        headline: 'Invite sent',
        gaps: [],
        strengths: [],
        source: null,
      },
    });

    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/intake']}>
        <Routes>
          <Route path="/intake" element={<JobIntakePage />} />
          <Route path="/jobs/:id" element={<h1>Left intake</h1>} />
          <Route path="/job-progress" element={<h1>Job file</h1>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Marcus Webb')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: /^Name$/i }), 'East Racine');
    await user.type(
      screen.getByPlaceholderText('1842 Meridian Ave, Austin, TX 78702'),
      '1842 Meridian Ave',
    );
    await user.click(screen.getByRole('button', { name: /Approve & invite/i }));

    expect(await screen.findByRole('heading', { name: 'Job created — capture invited' })).toBeInTheDocument();
    expect(screen.getByText('/shared/tok-1', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(screen.queryByText('Left intake')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Open this job file' }));
    expect(await screen.findByText('Job file')).toBeInTheDocument();
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
    expect(
      screen.getByText('Name it and the site. A note and invites are optional.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Name the job, then the site. A short note and invites are optional.'),
    ).toBeNull();
    expect(screen.queryByText('What this job is called on the dashboard.')).toBeNull();
    expect(screen.queryByText('Where the crew will work.')).toBeNull();

    expect(screen.getByRole('heading', { name: 'Name' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Address' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Situation' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Invite list' })).toBeInTheDocument();

    expect(screen.getByRole('textbox', { name: /^Name$/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /^Address$/i })).toBeInTheDocument();

    expect(await screen.findByText('Marcus Webb')).toBeInTheDocument();
    expect(screen.queryByText('Capture')).toBeNull();
    expect(
      screen.getByText('Selected people get a capture link. Add someone outside by email.'),
    ).toBeInTheDocument();

    const approve = screen.getByRole('button', { name: /Approve & invite/i });
    expect(approve.className).toMatch(/w-full/);
    expect(approve.className).toMatch(/rounded-xl/);
  });

  it('keeps Open this job file and Start another on the phone after approve', async () => {
    usePhoneShell.mockReturnValue(true);
    vi.mocked(api.approveIntake).mockResolvedValue({
      job: { id: 'job-new', title: 'East Racine', jobNumber: 12 },
      briefRevision: 1,
      scopeSaved: 0,
      invites: [
        {
          id: 'inv-1',
          name: 'Marcus Webb',
          email: 'marcus@example.com',
          sharePath: '/shared/tok-1',
          fieldCapturePath: '/fieldcapture/?token=tok-1',
          token: 'tok-1',
          emailed: true,
          recipientHasAccount: true,
        },
      ],
      party: { id: 'pty-1', company: 'Field Capture' },
      sharePath: '/shared/tok-1',
      fieldCapturePath: '/fieldcapture/?token=tok-1',
      readiness: {
        level: 'limited',
        ceiling: 'work_only',
        headline: 'Invite sent',
        gaps: [],
        strengths: [],
        source: null,
      },
    });

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <JobIntakePage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Marcus Webb')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: /^Name$/i }), 'East Racine');
    await user.type(
      screen.getByPlaceholderText('1842 Meridian Ave, Austin, TX 78702'),
      '1842 Meridian Ave',
    );
    await user.click(screen.getByRole('button', { name: /Approve & invite/i }));

    expect(await screen.findByRole('heading', { name: 'Job created — capture invited' })).toBeInTheDocument();
    expect(screen.getByText('Emailed — they already have an account.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open this job file' }).className).toMatch(/w-full/);
    expect(screen.getByRole('button', { name: 'Start another' }).className).toMatch(/w-full/);
  });

  it('emails the homeowner the job file after approve, account or not', async () => {
    vi.mocked(api.approveIntake).mockResolvedValue({
      job: { id: 'job-new', title: 'East Racine', jobNumber: 12 },
      briefRevision: 1,
      scopeSaved: 0,
      invites: [],
      party: { id: 'pty-1', company: 'Field Capture' },
      sharePath: '/shared/tok-1',
      fieldCapturePath: '/fieldcapture/?token=tok-1',
      readiness: {
        level: 'limited',
        ceiling: 'work_only',
        headline: 'Invite sent',
        gaps: [],
        strengths: [],
        source: null,
      },
    });

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <JobIntakePage />
      </MemoryRouter>,
    );

    await user.type(screen.getByRole('textbox', { name: /^Name$/i }), 'East Racine');
    await user.type(
      screen.getByPlaceholderText('1842 Meridian Ave, Austin, TX 78702'),
      '1842 Meridian Ave',
    );
    await user.type(screen.getByLabelText(/homeowner email/i), 'jordan@example.com');
    await user.click(screen.getByRole('button', { name: /Approve & invite/i }));

    expect(await screen.findByText(/homeowner emailed the job file/i)).toBeInTheDocument();
    expect(api.createProgressShare).toHaveBeenCalledWith({
      jobId: 'job-new',
      label: 'jordan@example.com',
      recipientEmail: 'jordan@example.com',
    });
  });
});
