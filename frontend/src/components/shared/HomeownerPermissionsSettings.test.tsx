import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const homeownerPermissions = vi.fn();
const saveHomeownerPermissions = vi.fn();

vi.mock('../../lib/api', () => ({
  api: {
    homeownerPermissions: (...a: unknown[]) => homeownerPermissions(...a),
    saveHomeownerPermissions: (...a: unknown[]) => saveHomeownerPermissions(...a),
  },
}));

import { HomeownerPermissionsSettings } from './HomeownerPermissionsSettings';

const ALL = {
  seeVideos: true,
  seeTranscripts: true,
  seeAiSummaries: true,
  seeScope: true,
  seeEvidenceReport: true,
  seeAccessList: true,
  useChat: true,
  downloadFiles: true,
};

describe('HomeownerPermissionsSettings', () => {
  beforeEach(() => {
    homeownerPermissions.mockReset();
    saveHomeownerPermissions.mockReset();
    homeownerPermissions.mockResolvedValue({ permissions: ALL, shareDelayHours: 0, effective: ALL, defaults: ALL });
  });

  it('starts with everything on and saves a change for this job', async () => {
    const user = userEvent.setup();
    saveHomeownerPermissions.mockImplementation(async (_job: string, p: typeof ALL, d: number) => ({ permissions: p, shareDelayHours: d, effective: p, defaults: ALL }));
    render(<HomeownerPermissionsSettings jobId="job-1" />);

    const transcripts = await screen.findByTestId('homeowner-perm-switch-seeTranscripts');
    for (const el of screen.getAllByRole('switch')) expect(el).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('homeowner-perms-save')).toBeDisabled();

    await user.click(transcripts);
    expect(transcripts).toHaveAttribute('aria-checked', 'false');
    // Chat and the Evidence report are built from transcripts, so they go off with it.
    expect(screen.getByTestId('homeowner-perm-switch-useChat')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('homeowner-perm-switch-useChat')).toBeDisabled();
    expect(screen.getByTestId('homeowner-perm-switch-seeEvidenceReport')).toHaveAttribute('aria-checked', 'false');

    await user.click(screen.getByTestId('homeowner-perms-save'));
    await waitFor(() => expect(saveHomeownerPermissions).toHaveBeenCalledWith('job-1', { ...ALL, seeTranscripts: false }, 0));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');
  });

  it('defaults the sharing delay to None and saves 48 hours', async () => {
    const user = userEvent.setup();
    saveHomeownerPermissions.mockImplementation(async (_job: string, p: typeof ALL, d: number) => ({ permissions: p, shareDelayHours: d, effective: p, defaults: ALL }));
    render(<HomeownerPermissionsSettings jobId="job-1" />);
    const select = await screen.findByTestId('homeowner-share-delay');
    await waitFor(() => expect(select).toHaveValue('0'));
    await user.selectOptions(select, '48');
    await user.click(screen.getByTestId('homeowner-perms-save'));
    await waitFor(() => expect(saveHomeownerPermissions).toHaveBeenCalledWith('job-1', ALL, 48));
  });

  it('shows defaults read-only with Retry when settings fail to load', async () => {
    const user = userEvent.setup();
    homeownerPermissions.mockRejectedValueOnce(new Error('Not found'));
    render(<HomeownerPermissionsSettings jobId="job-1" />);
    expect(await screen.findByTestId('homeowner-perms-unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('homeowner-perm-switch-seeVideos')).toBeDisabled();
    expect(screen.getByTestId('homeowner-perm-switch-seeVideos')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('homeowner-perms-save')).toBeDisabled();
    await user.click(screen.getByTestId('homeowner-perms-retry'));
    await waitFor(() => expect(screen.queryByTestId('homeowner-perms-unavailable')).not.toBeInTheDocument());
    expect(screen.getByTestId('homeowner-perm-switch-seeVideos')).not.toBeDisabled();
  });

  it('summarises what the homeowner can see and do, and keeps Save in the footer', async () => {
    const user = userEvent.setup();
    render(<HomeownerPermissionsSettings jobId="job-1" />);
    const summary = await screen.findByTestId('homeowner-perms-summary');
    expect(summary).toHaveTextContent('Homeowner can see: Videos, Transcripts');
    expect(summary).toHaveTextContent('Can do: Chat, Download videos');
    expect(summary).toHaveTextContent('Delay: None');
    await user.click(screen.getByTestId('homeowner-perm-switch-seeVideos'));
    await user.selectOptions(screen.getByTestId('homeowner-share-delay'), '24');
    expect(summary).not.toHaveTextContent('Download videos');
    expect(summary).toHaveTextContent('Delay: 24 hours');
    expect(screen.getByTestId('homeowner-perms-footer')).toContainElement(screen.getByTestId('homeowner-perms-save'));
  });
});
