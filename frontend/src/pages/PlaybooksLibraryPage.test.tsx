import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PlaybooksLibraryPage } from './PlaybooksLibraryPage';

const listPlaybooks = vi.fn();
const getPlaybook = vi.fn();

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return {
    ...actual,
    api: {
      ...actual.api,
      listPlaybooks: (...args: unknown[]) => listPlaybooks(...args),
      getPlaybook: (...args: unknown[]) => getPlaybook(...args),
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
