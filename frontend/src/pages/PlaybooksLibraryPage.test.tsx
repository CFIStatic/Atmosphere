import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PlaybooksLibraryPage } from './PlaybooksLibraryPage';

const listPlaybooks = vi.fn();
const getPlaybook = vi.fn();
const playbookSourceJobs = vi.fn();
const createPlaybookFromJob = vi.fn();

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return {
    ...actual,
    api: {
      ...actual.api,
      listPlaybooks: (...args: unknown[]) => listPlaybooks(...args),
      getPlaybook: (...args: unknown[]) => getPlaybook(...args),
      playbookSourceJobs: (...args: unknown[]) => playbookSourceJobs(...args),
      createPlaybookFromJob: (...args: unknown[]) => createPlaybookFromJob(...args),
      publishPlaybook: vi.fn(),
      archivePlaybook: vi.fn(),
    },
  };
});

vi.mock('../hooks/useFeatureTimer', () => ({
  useFeatureTimer: () => undefined,
}));

describe('PlaybooksLibraryPage', () => {
  beforeEach(() => {
    listPlaybooks.mockReset();
    getPlaybook.mockReset();
    playbookSourceJobs.mockReset();
    createPlaybookFromJob.mockReset();
    playbookSourceJobs.mockResolvedValue({ jobs: [] });
  });

  it('shows empty state when the org has no playbooks', async () => {
    listPlaybooks.mockResolvedValue({ playbooks: [] });
    render(
      <MemoryRouter initialEntries={['/playbooks']}>
        <Routes>
          <Route path="/playbooks" element={<PlaybooksLibraryPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText(/No playbooks yet/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/ordered checklists/i)).toBeInTheDocument();
    // Never a dead end that sends a Global Admin to "the API".
    expect(screen.queryByText(/via the API/i)).toBeNull();
    expect(screen.queryByText(/Ask your admin/i)).toBeNull();
    expect(await screen.findByText(/No job has an analyzed clip yet/i)).toBeInTheDocument();
  });

  it('creates the first playbook from a completed job and opens it', async () => {
    const created = {
      id: 'pb-new',
      orgId: 'org',
      title: 'Handyman — Tiffany & Co.',
      trade: 'handyman',
      summary: null,
      status: 'draft',
      sourceKind: 'job_analysis',
      sourceJobId: 'job-12',
      skillTags: [],
      stepCount: 3,
      createdBy: null,
      createdAt: '2026-09-28T00:00:00Z',
      updatedAt: '2026-09-28T00:00:00Z',
    };
    listPlaybooks.mockResolvedValueOnce({ playbooks: [] }).mockResolvedValue({ playbooks: [created] });
    getPlaybook.mockResolvedValue({ playbook: { ...created, steps: [] } });
    // The server lists only jobs /from-job accepts (see backend playbookSourceJobs).
    playbookSourceJobs.mockResolvedValue({
      jobs: [{ jobId: 'job-12', label: '#12 Tiffany & Co.', analyzedClips: 1 }],
    });
    createPlaybookFromJob.mockResolvedValue({ playbook: created });

    render(
      <MemoryRouter initialEntries={['/playbooks']}>
        <Routes>
          <Route path="/playbooks" element={<PlaybooksLibraryPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const select = await screen.findByRole('combobox', { name: 'Completed job' });
    expect(select).toHaveTextContent('#12 Tiffany & Co. · 1 analyzed clip');
    expect(select).not.toHaveTextContent('Empty');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Create playbook' }));
    expect(createPlaybookFromJob).toHaveBeenCalledWith('job-12');
    await waitFor(() => {
      expect(screen.getByTestId('playbook-card-pb-new')).toBeInTheDocument();
    });
  });

  it('a slow earlier list response cannot hide the playbook just created', async () => {
    const created = {
      id: 'pb-new',
      orgId: 'org',
      title: 'Handyman — Tiffany & Co.',
      trade: 'handyman',
      summary: null,
      status: 'draft',
      sourceKind: 'job_analysis',
      sourceJobId: 'job-12',
      skillTags: [],
      stepCount: 3,
      createdBy: null,
      createdAt: '2026-09-28T00:00:00Z',
      updatedAt: '2026-09-28T00:00:00Z',
    };
    const existing = { ...created, id: 'pb-old', title: 'Roofing — tear-off' };
    const slow: Array<(v: { playbooks: unknown[] }) => void> = [];
    let createdYet = false;
    listPlaybooks.mockImplementation((query: { q?: string }) => {
      // A filtered search that is still in flight when the create lands.
      if (query.q) return new Promise((resolve) => slow.push(resolve));
      return Promise.resolve({ playbooks: createdYet ? [existing, created] : [existing] });
    });
    getPlaybook.mockResolvedValue({ playbook: { ...created, steps: [] } });
    playbookSourceJobs.mockResolvedValue({
      jobs: [{ jobId: 'job-12', label: '#12 Tiffany & Co.', analyzedClips: 1 }],
    });
    createPlaybookFromJob.mockImplementation(async () => {
      createdYet = true;
      return { playbook: created };
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/playbooks']}>
        <Routes>
          <Route path="/playbooks" element={<PlaybooksLibraryPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: 'Create from completed job' }));
    await user.type(screen.getByPlaceholderText('Search title or trade'), 'zz');
    await user.click(await screen.findByRole('button', { name: 'Create playbook' }));
    await waitFor(() => expect(screen.getByTestId('playbook-card-pb-new')).toBeInTheDocument());
    expect(slow.length).toBeGreaterThan(0);
    for (const release of slow) release({ playbooks: [] });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('playbook-card-pb-new')).toBeInTheDocument();
  });

  it('lists playbook cards', async () => {
    listPlaybooks.mockResolvedValue({
      playbooks: [
        {
          id: 'pb-1',
          orgId: 'org',
          title: 'Roofing — tear-off to dry-in',
          trade: 'roofing',
          summary: 'From Maple job',
          status: 'draft',
          sourceKind: 'job_analysis',
          sourceJobId: 'job-1',
          skillTags: ['remove', 'protect'],
          stepCount: 4,
          createdBy: null,
          createdAt: '2026-09-14T00:00:00Z',
          updatedAt: '2026-09-14T00:00:00Z',
        },
      ],
    });
    render(
      <MemoryRouter initialEntries={['/playbooks']}>
        <Routes>
          <Route path="/playbooks" element={<PlaybooksLibraryPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText(/Roofing — tear-off to dry-in/i)).toBeInTheDocument();
    });
    expect(screen.getByTestId('playbooks-grid')).toBeInTheDocument();
  });
});
