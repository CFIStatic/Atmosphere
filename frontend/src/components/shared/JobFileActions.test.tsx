import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const renameJobFile = vi.fn();
const duplicateJobFile = vi.fn();
const deleteJobFile = vi.fn();

vi.mock('../../lib/api', () => ({
  api: {
    renameJobFile: (...args: unknown[]) => renameJobFile(...args),
    duplicateJobFile: (...args: unknown[]) => duplicateJobFile(...args),
    deleteJobFile: (...args: unknown[]) => deleteJobFile(...args),
  },
}));

import { JobFileActions } from './JobFileActions';

describe('JobFileActions', () => {
  beforeEach(() => {
    renameJobFile.mockReset();
    duplicateJobFile.mockReset();
    deleteJobFile.mockReset();
    deleteJobFile.mockResolvedValue({ ok: true, deletedAt: '2026-08-31T00:00:00Z', jobId: 'job-1' });
    renameJobFile.mockResolvedValue({
      job: { id: 'job-1', jobNumber: 12, title: 'Kitchen rebuild', status: 'scheduled', claimNumber: null },
    });
    duplicateJobFile.mockResolvedValue({
      job: { id: 'job-2', title: 'Copy of Cedar Ridge', jobNumber: 13 },
      briefRevision: 1,
      scopeSaved: 2,
      jobFile: {
        jobId: 'job-2',
        jobNumber: 13,
        title: 'Copy of Cedar Ridge',
        status: 'scheduled',
        parties: 0,
        currentRevision: 1,
        behind: 0,
        awaiting: 0,
        exclusions: 0,
      },
    });
  });

  it('renames the open job file', async () => {
    const onRenamed = vi.fn();
    const user = userEvent.setup();
    render(
      <JobFileActions
        jobId="job-1"
        title="Cedar Ridge"
        onRenamed={onRenamed}
        onDuplicated={() => undefined}
        onShare={() => undefined}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const field = screen.getByLabelText(/^Name$/i);
    expect(field).toHaveValue('Cedar Ridge');
    await user.clear(field);
    await user.type(field, 'Kitchen rebuild');
    await user.click(screen.getByRole('button', { name: 'Save name' }));

    expect(renameJobFile).toHaveBeenCalledWith('job-1', 'Kitchen rebuild');
    expect(await screen.findByRole('button', { name: 'Rename' })).toBeInTheDocument();
    expect(onRenamed).toHaveBeenCalledWith('Kitchen rebuild');
  });

  it('does not show the raw Forbidden status when duplicate fails', async () => {
    duplicateJobFile.mockRejectedValueOnce(new Error('Forbidden'));
    const user = userEvent.setup();
    render(
      <JobFileActions
        jobId="job-1"
        title="Mobil test one"
        onRenamed={() => undefined}
        onDuplicated={() => undefined}
        onShare={() => undefined}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Duplicate' }));
    await user.click(screen.getByRole('button', { name: 'Create copy' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not duplicate that job file. Try again.',
    );
    expect(screen.queryByText('Forbidden')).not.toBeInTheDocument();
  });

  it('duplicates the open job file under a new name', async () => {
    const onDuplicated = vi.fn();
    const user = userEvent.setup();
    render(
      <JobFileActions
        jobId="job-1"
        title="Cedar Ridge"
        onRenamed={() => undefined}
        onDuplicated={onDuplicated}
        onShare={() => undefined}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Duplicate' }));
    expect(screen.getByLabelText(/^Name$/i)).toHaveValue('Copy of Cedar Ridge');
    await user.click(screen.getByRole('button', { name: 'Create copy' }));

    expect(duplicateJobFile).toHaveBeenCalledWith('job-1', 'Copy of Cedar Ridge');
    expect(onDuplicated).toHaveBeenCalledWith({
      jobId: 'job-2',
      title: 'Copy of Cedar Ridge',
      summary: expect.objectContaining({ jobId: 'job-2', title: 'Copy of Cedar Ridge' }),
    });
  });

  it('refuses to delete until the file name is typed exactly', async () => {
    const onDeleted = vi.fn();
    const user = userEvent.setup();
    render(
      <JobFileActions
        jobId="job-1"
        title="Cedar Ridge"
        onRenamed={() => undefined}
        onDuplicated={() => undefined}
        onDeleted={onDeleted}
        onShare={() => undefined}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('heading', { name: 'Delete this job file' })).toBeInTheDocument();
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Delete permanently' });
    expect(confirm).toBeDisabled();

    await user.type(screen.getByLabelText(/^File name$/i), 'cedar ridge');
    expect(confirm).toBeDisabled();
    await user.clear(screen.getByLabelText(/^File name$/i));
    await user.type(screen.getByLabelText(/^File name$/i), 'Cedar Ridge');
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    expect(deleteJobFile).toHaveBeenCalledWith('job-1', 'Cedar Ridge');
    expect(onDeleted).toHaveBeenCalled();
  });
});
