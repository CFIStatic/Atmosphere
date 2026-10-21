import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api, type JobSuggestion } from '../../lib/api';
import { SUGGESTED_WORK_ASK_EVENT, takeSuggestedAsk } from '../../lib/suggestedWork';
import { JobSuggestions } from './JobSuggestions';

const SUG: JobSuggestion = {
  id: 's1',
  jobId: 'job-1',
  jobTitle: 'TEST Kitchen water loss',
  kind: 'build_estimate',
  status: 'open',
  title: 'Build the estimate in Xactimate',
  detail: 'Kitchen is on video with moisture readings and the cause of loss (burst supply line).',
  reason: 'The inspection is documented and there is no estimate on this job yet.',
  prompt: 'Use Computer to build the estimate in Xactimate. Stop for my approval before anything is saved or submitted.',
  handoff: 'chat',
  createdAt: '2026-10-21T12:00:00Z',
};

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe('JobSuggestions', () => {
  it('renders nothing when there is nothing to suggest', async () => {
    vi.spyOn(api, 'listSuggestions').mockResolvedValue({ suggestions: [] });
    const { container } = render(<JobSuggestions jobId="job-1" onHandoff={() => undefined} />);
    await waitFor(() => expect(api.listSuggestions).toHaveBeenCalledWith('job-1'));
    expect(container.querySelector('[data-testid="job-suggestions"]')).toBeNull();
  });

  it('Approve hands the prompt to Chat once and opens Chat', async () => {
    vi.spyOn(api, 'listSuggestions').mockResolvedValue({ suggestions: [SUG] });
    vi.spyOn(api, 'approveSuggestion').mockResolvedValue({ suggestion: { ...SUG, status: 'approved' }, prompt: SUG.prompt });
    const onHandoff = vi.fn();
    const heard = vi.fn();
    window.addEventListener(SUGGESTED_WORK_ASK_EVENT, heard);
    render(<JobSuggestions jobId="job-1" onHandoff={onHandoff} />);
    fireEvent.click(await screen.findByTestId('suggestion-approve'));
    await waitFor(() => expect(onHandoff).toHaveBeenCalled());
    expect(api.approveSuggestion).toHaveBeenCalledWith('s1', null);
    expect(heard).toHaveBeenCalled();
    expect(takeSuggestedAsk('job-1')).toBe(SUG.prompt);
    expect(takeSuggestedAsk('job-1')).toBeNull();
    expect(screen.queryByTestId('suggestion-card')).toBeNull();
    window.removeEventListener(SUGGESTED_WORK_ASK_EVENT, heard);
  });

  it('Edit sends the changed request with Approve', async () => {
    vi.spyOn(api, 'listSuggestions').mockResolvedValue({ suggestions: [SUG] });
    vi.spyOn(api, 'approveSuggestion').mockResolvedValue({ suggestion: SUG, prompt: 'Only the kitchen.' });
    render(<JobSuggestions jobId="job-1" onHandoff={() => undefined} />);
    fireEvent.click(await screen.findByTestId('suggestion-edit'));
    fireEvent.change(screen.getByTestId('suggestion-prompt'), { target: { value: 'Only the kitchen.' } });
    fireEvent.click(screen.getByTestId('suggestion-approve'));
    await waitFor(() => expect(api.approveSuggestion).toHaveBeenCalledWith('s1', 'Only the kitchen.'));
  });

  it('Dismiss removes the card without asking Chat', async () => {
    vi.spyOn(api, 'listSuggestions').mockResolvedValue({ suggestions: [SUG] });
    vi.spyOn(api, 'dismissSuggestion').mockResolvedValue({ suggestion: { ...SUG, status: 'dismissed' } });
    const onHandoff = vi.fn();
    render(<JobSuggestions jobId="job-1" onHandoff={onHandoff} />);
    fireEvent.click(await screen.findByTestId('suggestion-dismiss'));
    await waitFor(() => expect(screen.queryByTestId('suggestion-card')).toBeNull());
    expect(onHandoff).not.toHaveBeenCalled();
    expect(takeSuggestedAsk('job-1')).toBeNull();
  });
});
