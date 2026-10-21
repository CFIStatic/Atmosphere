import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { api, type JobSuggestion } from '../lib/api';
import { takeSuggestedAsk } from '../lib/suggestedWork';
import { SuggestedWorkPage } from './SuggestedWorkPage';

const base: JobSuggestion = {
  id: 's1',
  jobId: 'job-1',
  jobTitle: 'TEST Kitchen water loss',
  kind: 'crm_update',
  status: 'open',
  title: 'Update the job in your CRM',
  detail: 'Since the last update: the adjuster visited.',
  reason: null,
  prompt: 'Use Computer to update this job in our CRM. Stop for my approval before saving.',
  handoff: 'chat',
  createdAt: '2026-10-21T12:00:00Z',
};

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe('SuggestedWorkPage', () => {
  it('groups by job, and Approve opens that job’s Chat with the request waiting', async () => {
    vi.spyOn(api, 'listSuggestions').mockResolvedValue({
      suggestions: [base, { ...base, id: 's2', jobId: 'job-2', jobTitle: 'TEST Basement', kind: 'homeowner_update', title: 'Send the homeowner an update' }],
    });
    vi.spyOn(api, 'approveSuggestion').mockResolvedValue({ suggestion: base, prompt: base.prompt });
    render(
      <MemoryRouter initialEntries={['/suggested-work']}>
        <Routes>
          <Route path="/suggested-work" element={<SuggestedWorkPage />} />
          <Route path="/job-progress" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('TEST Kitchen water loss')).toBeInTheDocument();
    expect(screen.getByText('TEST Basement')).toBeInTheDocument();
    fireEvent.click(screen.getAllByTestId('suggestion-approve')[0]);
    await waitFor(() => expect(screen.getByTestId('where').textContent).toContain('job=job-1'));
    expect(screen.getByTestId('where').textContent).toContain('ask=1');
    expect(takeSuggestedAsk('job-1')).toBe(base.prompt);
  });

  it('says when there is nothing to suggest', async () => {
    vi.spyOn(api, 'listSuggestions').mockResolvedValue({ suggestions: [] });
    render(
      <MemoryRouter>
        <SuggestedWorkPage />
      </MemoryRouter>,
    );
    expect(await screen.findByTestId('suggested-work-empty')).toBeInTheDocument();
  });
});
