import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PlaybooksLibraryPage } from './PlaybooksLibraryPage';

const listPlaybooks = vi.fn();
const getPlaybook = vi.fn();
const evidenceLibrary = vi.fn();
const createPlaybookFromJob = vi.fn();

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return {
    ...actual,
    api: {
      ...actual.api,
      listPlaybooks: (...args: unknown[]) => listPlaybooks(...args),
      getPlaybook: (...args: unknown[]) => getPlaybook(...args),
      evidenceLibrary: (...args: unknown[]) => evidenceLibrary(...args),
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
    evidenceLibrary.mockReset();
    createPlaybookFromJob.mockReset();
    evidenceLibrary.mockResolvedValue({ items: [] });
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
    listPlaybooks
      .mockResolvedValueOnce({ playbooks: [] })
      .mockResolvedValue({ playbooks: [created] });
    getPlaybook.mockResolvedValue({ playbook: { ...created, steps: [] } });
    evidenceLibrary.mockResolvedValue({
      items: [
        {
          id: 'c-1',
          jobId: 'job-12',
          jobName: 'Tiffany & Co.',
          jobNumber: 12,
          analysisState: 'done',
          analysis: { summary: 'Crew finished the punch list.' },
        },
        { id: 'c-2', jobId: 'job-13', jobName: 'Empty', jobNumber: 13, analysisState: 'pending' },
        {
          id: 'c-3',
          jobId: 'job-14',
          jobName: 'Mic only',
          jobNumber: 14,
          analysisState: 'done',
          analysis: { transcript: 'just talking' },
        },
      ],
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
    expect(select).not.toHaveTextContent('Mic only');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Create playbook' }));
    expect(createPlaybookFromJob).toHaveBeenCalledWith('job-12');
    await waitFor(() => {
      expect(screen.getByTestId('playbook-card-pb-new')).toBeInTheDocument();
    });
  });

  it('keeps the new draft when a filtered reload finishes after create', async () => {
    const published = {
      id: 'pb-pub',
      orgId: 'org',
      title: 'Published roof',
      trade: 'roofing',
      summary: null,
      status: 'published' as const,
      sourceKind: 'job_analysis',
      sourceJobId: 'job-1',
      skillTags: [],
      stepCount: 2,
      createdBy: null,
      createdAt: '2026-09-14T00:00:00Z',
      updatedAt: '2026-09-14T00:00:00Z',
    };
    const created = {
      id: 'pb-new',
      orgId: 'org',
      title: 'Draft from job',
      trade: 'handyman',
      summary: null,
      status: 'draft' as const,
      sourceKind: 'job_analysis',
      sourceJobId: 'job-12',
      skillTags: [],
      stepCount: 3,
      createdBy: null,
      createdAt: '2026-09-28T00:00:00Z',
      updatedAt: '2026-09-28T00:00:00Z',
    };
    let includeDraft = false;
    let releaseFiltered: () => void = () => {};
    const filteredGate = new Promise<void>((resolve) => {
      releaseFiltered = resolve;
    });
    listPlaybooks.mockImplementation(async (query: { status?: string }) => {
      if (query?.status === 'published') {
        await filteredGate;
        return { playbooks: [published] };
      }
      return { playbooks: includeDraft ? [published, created] : [published] };
    });
    evidenceLibrary.mockResolvedValue({
      items: [
        {
          id: 'c-1',
          jobId: 'job-12',
          jobName: 'Tiffany & Co.',
          jobNumber: 12,
          analysisState: 'done',
          analysis: { summary: 'Crew finished the punch list.' },
        },
      ],
    });
    createPlaybookFromJob.mockResolvedValue({ playbook: created });
    getPlaybook.mockResolvedValue({ playbook: { ...created, steps: [] } });

    render(
      <MemoryRouter initialEntries={['/playbooks']}>
        <Routes>
          <Route path="/playbooks" element={<PlaybooksLibraryPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('Published roof');
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Status'), 'published');
    includeDraft = true;
    await user.click(screen.getByRole('button', { name: 'Create from completed job' }));
    await user.click(await screen.findByRole('button', { name: 'Create playbook' }));

    await waitFor(() => {
      expect(screen.getByTestId('playbook-card-pb-new')).toBeInTheDocument();
    });
    await act(async () => {
      releaseFiltered();
      await filteredGate;
      await Promise.resolve();
    });
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
