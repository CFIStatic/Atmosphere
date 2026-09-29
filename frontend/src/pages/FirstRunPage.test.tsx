import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  membership: { org: { id: 'org-1', name: 'Acme Restoration' } } as { org: { id: string; name: string } | null } | null,
  membershipLoading: false,
  logout: vi.fn(),
}));

const apiMocks = vi.hoisted(() => ({
  getBillingOnboarding: vi.fn(),
  approveIntake: vi.fn(),
  jobProofs: vi.fn(),
  evidenceLibrary: vi.fn(),
}));

vi.mock('../context/AuthContext', () => ({ useAuth: () => authState }));
vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return { ...actual, api: apiMocks };
});
vi.mock('../components/ThemeToggle', () => ({ ThemeToggle: () => null }));

import { FirstRunPage } from './FirstRunPage';

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{`${loc.pathname}${loc.search}`}</p>;
}

function renderPage(entry = '/welcome') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/welcome" element={<FirstRunPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('FirstRunPage (value before payment)', () => {
  beforeEach(() => {
    localStorage.clear();
    apiMocks.getBillingOnboarding.mockReset().mockResolvedValue({ required: true, complete: false });
    apiMocks.approveIntake
      .mockReset()
      .mockResolvedValue({ job: { id: 'job-1', title: 'Smith kitchen leak', jobNumber: 1 } });
    apiMocks.jobProofs.mockReset().mockResolvedValue({ days: [], videos: [], counts: { days: 0, payable: 0, contradicted: 0 } });
    apiMocks.evidenceLibrary.mockReset().mockResolvedValue({ items: [] });
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  it('names the first job, shows labeled sample evidence, and only then offers a plan', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Name your first job' })).toBeInTheDocument();
    // No plan, card, collaborator or homeowner-sharing controls before first evidence.
    expect(screen.queryByRole('button', { name: /plan/i })).toBeNull();
    expect(screen.queryByLabelText(/email/i)).toBeNull();
    expect(screen.queryByText(/card|homeowner/i)).toBeNull();

    await user.type(screen.getByLabelText('Job name'), 'Smith kitchen leak');
    await user.click(screen.getByRole('button', { name: 'Create job' }));
    expect(apiMocks.approveIntake).toHaveBeenCalledWith({ title: 'Smith kitchen leak', scope: [], invitees: [] });

    await user.click(await screen.findByTestId('first-run-office'));
    const sample = await screen.findByTestId('sample-evidence');
    expect(sample).toHaveTextContent('Sample');
    expect(sample.querySelector('img')?.getAttribute('src')).toBe('/samples/kitchen-leak-poster.jpg');
    expect(screen.getByText(/This is a sample, not your data/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the job file' }).getAttribute('href')).toContain(
      '/job-progress?job=job-1',
    );

    await user.click(screen.getByRole('button', { name: 'Choose a plan' }));
    const where = await screen.findByTestId('where');
    expect(where.textContent).toMatch(/^\/signup\?step=2&next=/);
    expect(decodeURIComponent(where.textContent ?? '')).toContain('/job-progress?job=job-1');
  });

  it('field path offers a plan before any clip, because recording is locked until checkout', async () => {
    const user = userEvent.setup();
    localStorage.setItem('atmosphere.firstRun.org-1', JSON.stringify({ jobId: 'job-1', jobTitle: 'Smith kitchen leak' }));
    renderPage();
    await user.click(await screen.findByTestId('first-run-field'));
    expect(window.open).not.toHaveBeenCalled();
    expect(await screen.findByRole('heading', { name: 'Choose a plan to record' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open Field Capture' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'See sample evidence instead' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Choose a plan' }));
    const where = await screen.findByTestId('where');
    expect(where.textContent).toMatch(/^\/signup\?step=2&next=/);
  });

  it('field path shows the first clip (title, timestamps, summary) and then enables the plan step', async () => {
    localStorage.setItem(
      'atmosphere.firstRun.org-1',
      JSON.stringify({ jobId: 'job-1', jobTitle: 'Smith kitchen leak', path: 'field' }),
    );
    apiMocks.jobProofs.mockResolvedValue({
      days: [],
      videos: [
        {
          id: 'clip-1',
          durationSeconds: 44.24,
          analysisStatus: 'done',
          transcriptStatus: 'done',
          narrationStatus: 'done',
          transcriptSegments: [{ tSec: 11, text: 'You know I love that girl.' }],
          aiSummary: 'Walkthrough.',
        },
      ],
      counts: { days: 1, payable: 0, contradicted: 0 },
    });
    apiMocks.evidenceLibrary.mockResolvedValue({ items: [{ id: 'clip-1', title: 'Handheld Phone Video' }] });
    renderPage();
    const card = await screen.findByTestId('first-clip');
    expect(card).toHaveTextContent('Handheld Phone Video');
    expect(card).toHaveTextContent('0:11');
    expect(card).toHaveTextContent('0:44');
    expect(screen.getByRole('heading', { name: 'Your first evidence' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Choose a plan' })).toBeEnabled());
    expect(JSON.parse(localStorage.getItem('atmosphere.firstRun.org-1') ?? '{}').evidenceSeen).toBe(true);
  });

  it('shows an unknown length when the clip header has no duration', async () => {
    localStorage.setItem(
      'atmosphere.firstRun.org-1',
      JSON.stringify({ jobId: 'job-1', jobTitle: 'Smith kitchen leak', path: 'field' }),
    );
    apiMocks.jobProofs.mockResolvedValue({
      days: [],
      videos: [
        {
          id: 'clip-1',
          durationSeconds: 0,
          analysisStatus: 'done',
          transcriptStatus: 'done',
          narrationStatus: 'done',
          transcriptSegments: [{ tSec: 0, text: 'Started under the sink.' }],
          aiSummary: 'Walkthrough.',
        },
      ],
      counts: { days: 1, payable: 0, contradicted: 0 },
    });
    apiMocks.evidenceLibrary.mockResolvedValue({ items: [{ id: 'clip-1', title: 'First clip' }] });
    renderPage();
    const card = await screen.findByTestId('first-clip');
    const badge = card.querySelector('span.absolute');
    expect(badge).toHaveTextContent('—');
    expect(badge).not.toHaveTextContent('0:00');
    expect(card).toHaveTextContent('0:00');
    expect(card).toHaveTextContent('Started under the sink.');
  });

  it('sends a paid workspace straight to its job', async () => {
    apiMocks.getBillingOnboarding.mockResolvedValue({ required: true, complete: true });
    localStorage.setItem('atmosphere.firstRun.org-1', JSON.stringify({ jobId: 'job-1', jobTitle: 'Smith' }));
    renderPage();
    await waitFor(() => expect(screen.getByTestId('where').textContent).toContain('/job-progress?job=job-1'));
  });

  it('never follows an off-site ?next= (security review)', async () => {
    apiMocks.getBillingOnboarding.mockResolvedValue({ required: true, complete: true });
    renderPage('/welcome?next=//evil.example/phish');
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/intake'));
  });
});
