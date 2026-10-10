import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sharedJobs = vi.fn();
const sharedJob = vi.fn();
const renameJobFile = vi.fn();
const duplicateJobFile = vi.fn();
const jobProofs = vi.fn();
const proofQuestions = vi.fn();
const getBillingOnboarding = vi.fn();
const orgInvites = vi.fn();
const getBillingWorkspace = vi.fn();
const evidenceShares = vi.fn();
const createProgressShare = vi.fn();
const createOrgInvite = vi.fn();

vi.mock('../hooks/useFeatureTimer', () => ({
  useFeatureTimer: () => undefined,
}));

const authMembership = vi.hoisted(() => ({
  current: { role: 'global_admin', org: { id: 'org-1', name: 'Jettx' } } as
    | { role: string; org: { id: string; name: string } }
    | null,
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    membership: authMembership.current,
  }),
}));

const usePhoneShell = vi.fn(() => false);

vi.mock('../lib/usePhoneShell', () => ({
  usePhoneShell: () => usePhoneShell(),
}));

vi.mock('../components/JobAskPanel', () => ({
  JobAskPanel: () => <div data-testid="job-ask-panel" aria-label="Ask this job" />,
}));

vi.mock('../components/shared/JobTimeline', () => ({
  JobTimeline: () => (
    <div data-testid="job-timeline">
      <h2>Timeline</h2>
    </div>
  ),
}));

vi.mock('../components/shared/JobFileReport', () => ({
  JobFileReport: () => <div>Job file report</div>,
}));

vi.mock('../components/shared/ProofOfWork', () => ({
  ProofOfWork: ({ heading }: { heading?: string }) => (
    <section>{heading ?? 'Proof of work'}</section>
  ),
}));

vi.mock('../components/shared/JobReadinessPanel', () => ({
  JobReadinessPanel: () => null,
}));

vi.mock('../components/shared/JobAccessRoster', () => ({
  JobAccessRoster: () => <div data-testid="job-access-roster">Who has access</div>,
}));

vi.mock('../components/team/InvitePanel', () => ({
  InvitePanel: () => (
    <section>
      <input placeholder="their@email.com" />
      <button type="button">Invite</button>
    </section>
  ),
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
    jobProofs: (...args: unknown[]) => jobProofs(...args),
    proofQuestions: (...args: unknown[]) => proofQuestions(...args),
    getBillingOnboarding: (...args: unknown[]) => getBillingOnboarding(...args),
    orgInvites: (...args: unknown[]) => orgInvites(...args),
    getBillingWorkspace: (...args: unknown[]) => getBillingWorkspace(...args),
    evidenceShares: (...args: unknown[]) => evidenceShares(...args),
    createProgressShare: (...args: unknown[]) => createProgressShare(...args),
    createOrgInvite: (...args: unknown[]) => createOrgInvite(...args),
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
    authMembership.current = { role: 'global_admin', org: { id: 'org-1', name: 'Jettx' } };
    usePhoneShell.mockReturnValue(false);
    sharedJobs.mockReset();
    sharedJob.mockReset();
    renameJobFile.mockReset();
    duplicateJobFile.mockReset();
    jobProofs.mockReset();
    proofQuestions.mockReset();
    getBillingOnboarding.mockReset().mockResolvedValue({ required: false, complete: true });
    orgInvites.mockReset().mockResolvedValue({ invites: [] });
    getBillingWorkspace.mockReset().mockResolvedValue({});
    evidenceShares.mockReset().mockResolvedValue({ shares: [] });
    createProgressShare.mockReset();
    createOrgInvite.mockReset();
    jobProofs.mockResolvedValue({
      days: [],
      videos: [],
      counts: { days: 0, videos: 0, payable: 0, contradicted: 0, awaitingAfter: 0 },
      siteKnown: true,
    });
    proofQuestions.mockResolvedValue({ questions: [] });
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
    expect(screen.getByTestId('job-file-section-bar')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('job-file-ask')).toBeInTheDocument();
    expect(screen.queryByTestId('job-timeline')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Videos' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Evidence report' })).toBeInTheDocument();
    expect(screen.queryByText('Job file report')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Legal hold' })).not.toBeInTheDocument();
    expect(screen.queryByText('Place this job on legal hold')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duplicate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share with homeowner' })).toBeInTheDocument();

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

  it('keeps Ask under the Chat section tab — not a left column beside the file', async () => {
    render(
      <MemoryRouter initialEntries={['/job-progress?job=job-1038']}>
        <SharedDashboardPage />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Cedar Ridge — storm damage' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('job-file')).toHaveAttribute('data-ask-placement', 'section');
    expect(screen.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('job-timeline')).not.toBeInTheDocument();
    expect(screen.queryByTestId('job-file-ask-split')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Ask' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'File' })).not.toBeInTheDocument();

    const ask = screen.getByTestId('job-file-ask');
    expect(ask).toHaveAttribute('aria-label', 'Ask this job');
    expect(ask).toContainElement(screen.getByTestId('job-ask-panel'));
    // ChatGPT-style: panel fills remaining height; composer sits at bottom (flex-1 + overflow), not a mid-panel min-height card.
    expect(ask.className).toMatch(/flex-1/);
    expect(ask.className).toMatch(/min-h-0/);
    expect(ask.className).not.toMatch(/min-h-\[/);
    expect(screen.getByTestId('job-file-section-panel-chat').className).toMatch(/flex-1/);
    expect(screen.queryByTestId('job-timeline')).not.toBeInTheDocument();

    expect(screen.queryByRole('button', { name: /Overview/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Overview/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Overview')).not.toBeInTheDocument();
    expect(screen.queryByTestId('job-file-back')).not.toBeInTheDocument();
    expect(screen.getByTestId('job-file')).toHaveAttribute(
      'data-job-file-chrome',
      'no-overview-back',
    );
    expect(screen.queryByText('What is happening on site')).not.toBeInTheDocument();
    expect(screen.queryByTestId('job-file-today')).not.toBeInTheDocument();
    expect(
      JSON.parse(localStorage.getItem('atmosphere.jobFileOpenedAt') ?? '{}')['job-1038'],
    ).toEqual(expect.any(Number));
  });

  it('shows the changed-today strip when clips, scope, or Ask landed today', async () => {
    sharedJob.mockResolvedValue({
      ...record,
      scope: [
        {
          id: 'sc-new',
          party_id: null,
          state: 'included',
          title: 'Replace valley flashing',
          detail: null,
          amount: null,
          reason: null,
          revision: 1,
          decided_at: null,
          created_at: new Date().toISOString(),
        },
      ],
    });
    jobProofs.mockResolvedValue({
      days: [],
      videos: [
        {
          id: 'p-today',
          partyId: 'pty-1',
          company: 'Delgado Roofing',
          workDate: new Date().toISOString().slice(0, 10),
          phase: 'after',
          durationSeconds: 40,
          analysisStatus: 'done',
          narrationStatus: 'done',
          transcriptStatus: 'done',
          transcriptError: null,
          aiSummary: 'New flashing.',
          heardOnMic: null,
          receivedAt: new Date().toISOString(),
        },
      ],
      counts: { days: 0, videos: 1, payable: 0, contradicted: 0, awaitingAfter: 0 },
      siteKnown: true,
    });
    proofQuestions.mockResolvedValue({
      questions: [
        {
          id: 'q-open',
          question: 'Did they finish the valley?',
          answer: null,
          grounded_on: [],
          created_at: new Date().toISOString(),
        },
      ],
    });

    render(
      <MemoryRouter initialEntries={['/job-progress?job=job-1038']}>
        <SharedDashboardPage />
      </MemoryRouter>,
    );

    const strip = await screen.findByTestId('job-file-today');
    expect(strip).toHaveTextContent('What changed today');
    expect(strip).toHaveTextContent('1 new clip');
    expect(strip).toHaveTextContent('1 new scope line');
    expect(strip).toHaveTextContent('1 unanswered Ask');
  });

  it('lands on Chat by default when opening a job file', async () => {
    render(
      <MemoryRouter initialEntries={['/job-progress?job=job-1038']}>
        <SharedDashboardPage />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('job-ask-panel')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Timeline' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(screen.queryByTestId('job-timeline')).not.toBeInTheDocument();
  });

  it('opens the Chat section first when deep-linked with ?ask=1', async () => {
    usePhoneShell.mockReturnValue(true);
    render(
      <MemoryRouter initialEntries={['/job-progress?job=job-1038&ask=1']}>
        <SharedDashboardPage />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('job-ask-panel')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('job-file-ask')).toContainElement(screen.getByTestId('job-ask-panel'));
    expect(screen.queryByRole('tab', { name: 'Ask' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('job-timeline')).not.toBeInTheDocument();
  });

  it('uses the Chat section tab on a phone — same Ask, no File/Ask chrome tabs', async () => {
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
    expect(screen.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Timeline' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(screen.queryByRole('tab', { name: 'File' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Ask' })).not.toBeInTheDocument();
    expect(screen.getByTestId('job-file-ask')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Overview/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Overview/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Overview')).not.toBeInTheDocument();
    expect(screen.queryByTestId('job-file-back')).not.toBeInTheDocument();
    expect(screen.getByTestId('job-file')).toHaveAttribute(
      'data-job-file-chrome',
      'no-overview-back',
    );
    expect(screen.getByTestId('job-file')).toHaveAttribute('data-ask-placement', 'section');

    expect(await screen.findByTestId('job-ask-panel')).toBeInTheDocument();
    expect(screen.getByTestId('job-file-ask')).toHaveAttribute('aria-label', 'Ask this job');

    await user.click(screen.getByRole('tab', { name: 'Timeline' }));
    expect(await screen.findByTestId('job-timeline')).toBeInTheDocument();
    expect(screen.queryByTestId('job-file-ask')).not.toBeInTheDocument();
  });

  it('shows a grant viewer no contractor job actions (the sidebar Dashboard is home)', async () => {
    authMembership.current = null;
    sharedJob.mockResolvedValue({ ...record, access: 'viewer' });

    render(
      <MemoryRouter initialEntries={['/job-progress?job=job-1038']}>
        <SharedDashboardPage />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('job-ask-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('your-job-files')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Access' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share with homeowner' })).not.toBeInTheDocument();
  });

  it('hides Who-has-access for grant / homeowner viewers', async () => {
    authMembership.current = null;
    sharedJob.mockResolvedValue({ ...record, access: 'viewer' });

    render(
      <MemoryRouter initialEntries={['/job-progress?job=job-1038']}>
        <SharedDashboardPage />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('job-ask-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('job-access-roster')).not.toBeInTheDocument();
    expect(screen.queryByTestId('similar-past-jobs')).not.toBeInTheDocument();
  });

  it('shows Who-has-access for office org members without Similar jobs', async () => {
    const user = userEvent.setup();
    authMembership.current = { role: 'global_admin', org: { id: 'org-1', name: 'Jettx' } };
    sharedJob.mockResolvedValue({ ...record, access: 'org' });

    render(
      <MemoryRouter initialEntries={['/job-progress?job=job-1038']}>
        <SharedDashboardPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('tab', { name: 'Access' })).toBeInTheDocument();
    expect(screen.queryByTestId('job-access-roster')).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Access' }));
    expect(await screen.findByTestId('job-access-roster')).toBeInTheDocument();
    expect(screen.queryByTestId('similar-past-jobs')).not.toBeInTheDocument();
  });

  it('puts Timeline where Happening Now was and drops Job facts and On the record', async () => {
    const user = userEvent.setup();
    authMembership.current = { role: 'global_admin', org: { id: 'org-1', name: 'Jettx' } };
    sharedJob.mockResolvedValue({ ...record, access: 'org' });

    render(
      <MemoryRouter initialEntries={['/job-progress?job=job-1038']}>
        <SharedDashboardPage />
      </MemoryRouter>,
    );

    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Chat',
      'Timeline',
      'Access',
      'Videos',
      'Evidence report',
    ]);
    expect(screen.queryByRole('tab', { name: 'Packet' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Job history' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Timeline' }));
    expect(await screen.findByTestId('job-timeline')).toBeInTheDocument();
    expect(screen.queryByTestId('job-documents-list')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Documents' })).not.toBeInTheDocument();
    expect(screen.queryByText('No documents on this job yet.')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Scope' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add a line' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Job facts' })).not.toBeInTheDocument();
    expect(screen.queryByText('Publish a change')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'On the record' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Nothing here can be edited or deleted/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('job-notes')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Notes' })).not.toBeInTheDocument();
  });

  it('opens Timeline for old Happening Now and Job history links', async () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={['/job-progress?job=job-1038&section=happening&ask=1']}>
        <SharedDashboardPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('tab', { name: 'Timeline' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.queryByTestId('job-ask-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('job-timeline')).toBeInTheDocument();
    unmount();

    render(
      <MemoryRouter initialEntries={['/job-progress?job=job-1038#job-history']}>
        <SharedDashboardPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('tab', { name: 'Timeline' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByTestId('job-timeline')).toBeInTheDocument();
  });

  it('opens Timeline for old Packet links and keeps Share and Evidence report', async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <MemoryRouter initialEntries={['/job-progress?job=job-1038&section=packet']}>
        <SharedDashboardPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('tab', { name: 'Timeline' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.queryByRole('tab', { name: 'Packet' })).not.toBeInTheDocument();
    expect(screen.getByTestId('job-timeline')).toBeInTheDocument();
    expect(screen.queryByTestId('claim-ready-packet')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share with homeowner' })).toBeInTheDocument();
    unmount();

    render(
      <MemoryRouter initialEntries={['/job-progress?job=job-1038&section=claim-ready']}>
        <SharedDashboardPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('tab', { name: 'Timeline' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.click(screen.getByRole('tab', { name: 'Evidence report' }));
    expect(screen.getByText('Job file report')).toBeInTheDocument();
  });

  it('shows only the active section panel', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/job-progress?job=job-1038']}>
        <SharedDashboardPage />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('job-file-ask')).toContainElement(
      screen.getByTestId('job-ask-panel'),
    );
    expect(screen.queryByTestId('job-timeline')).not.toBeInTheDocument();
    expect(screen.queryByText('Job file report')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Timeline' }));
    expect(screen.getByTestId('job-timeline')).toBeInTheDocument();
    expect(screen.queryByTestId('job-notes')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Notes' })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/add a note/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Post' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('job-file-ask')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Videos' }));
    expect(screen.getByTestId('job-file-section-panel-videos')).toHaveTextContent('Videos');
    expect(screen.queryByTestId('job-timeline')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Evidence report' }));
    expect(screen.getByText('Job file report')).toBeInTheDocument();
    expect(screen.queryByTestId('job-file-section-panel-videos')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Chat' }));
    expect(screen.getByTestId('job-file-ask')).toContainElement(screen.getByTestId('job-ask-panel'));
    expect(screen.queryByTestId('job-file-chat-handoff')).not.toBeInTheDocument();
  });

  it('never mounts Motion clips on the job file (org or grant)', async () => {
    authMembership.current = { role: 'global_admin', org: { id: 'org-1', name: 'Jettx' } };
    sharedJob.mockResolvedValue({ ...record, access: 'org' });

    const { unmount } = render(
      <MemoryRouter initialEntries={['/job-progress?job=job-1038']}>
        <SharedDashboardPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('tab', { name: 'Videos' })).toBeInTheDocument();
    expect(screen.queryByTestId('motion-clips-browser')).not.toBeInTheDocument();
    expect(screen.queryByText('Motion clips')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/skill corpus foundation for robotics/i),
    ).not.toBeInTheDocument();
    unmount();

    authMembership.current = null;
    sharedJob.mockResolvedValue({ ...record, access: 'viewer' });
    render(
      <MemoryRouter initialEntries={['/job-progress?job=job-1038']}>
        <SharedDashboardPage />
      </MemoryRouter>,
    );
    expect(await screen.findByTestId('job-ask-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('motion-clips-browser')).not.toBeInTheDocument();
    expect(screen.queryByText('Motion clips')).not.toBeInTheDocument();
  });

  it('lets an unpaid office preview the job file, invite panel, and homeowner share', async () => {
    getBillingOnboarding.mockResolvedValue({ required: true, complete: false });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/job-progress?job=job-1038']}>
        <SharedDashboardPage />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('unpaid-job-evaluation')).toBeInTheDocument();
    expect(screen.getByTestId('job-sample-evidence').querySelector('img')?.getAttribute('src')).toBe(
      '/samples/kitchen-leak-poster.jpg',
    );
    expect(screen.getByText('Kitchen leak walkthrough')).toBeInTheDocument();
    expect(screen.getAllByTestId('upgrade-prompt').length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText('their@email.com')).toBeInTheDocument();
    expect(screen.getByLabelText(/homeowner email/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/homeowner email/i), 'owner@example.com');
    await user.click(screen.getByRole('button', { name: /send homeowner invite/i }));
    expect(createProgressShare).not.toHaveBeenCalled();

    expect(screen.getByPlaceholderText('their@email.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite' })).toBeInTheDocument();
  });
});

