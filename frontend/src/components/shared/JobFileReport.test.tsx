import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { JobFileReport } from './JobFileReport';

const jobProofPackPdf = vi.fn();
vi.mock('../../lib/api', () => ({
  api: {
    jobProofPackPdf: (...args: unknown[]) => jobProofPackPdf(...args),
  },
}));

const downloadBlob = vi.fn();
vi.mock('../../lib/downloadBlob', () => ({
  downloadBlob: (...args: unknown[]) => downloadBlob(...args),
}));

describe('JobFileReport', () => {
  beforeEach(() => {
    jobProofPackPdf.mockReset();
    downloadBlob.mockReset();
  });

  it('downloads the whole job file as one PDF', async () => {
    const blob = new Blob(['%PDF'], { type: 'application/pdf' });
    jobProofPackPdf.mockResolvedValue({ blob, filename: 'atmosphere-job-1-report.pdf' });
    render(<JobFileReport jobId="job-1" />);
    fireEvent.click(screen.getByTestId('download-job-report'));
    await waitFor(() => {
      expect(jobProofPackPdf).toHaveBeenCalledWith('job-1', undefined, expect.anything());
      expect(downloadBlob).toHaveBeenCalledWith('atmosphere-job-1-report.pdf', blob);
    });
    expect(screen.getByRole('status').textContent).toMatch(/atmosphere-job-1-report\.pdf/);
  });

  it('says so when the report cannot be built', async () => {
    jobProofPackPdf.mockRejectedValue(new Error('Server busy'));
    render(<JobFileReport jobId="job-1" />);
    fireEvent.click(screen.getByTestId('download-job-report'));
    expect((await screen.findByRole('alert')).textContent).toBe('Server busy');
  });

  it('lists what the report contains', () => {
    render(<JobFileReport jobId="job-1" />);
    for (const title of ['Job details', 'Every video and file', 'Transcripts', 'Analysis results', 'Timeline', 'Access and custody']) {
      expect(screen.getByText(title)).toBeTruthy();
    }
  });
});
