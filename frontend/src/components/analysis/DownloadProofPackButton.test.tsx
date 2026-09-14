import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DownloadProofPackButton } from './DownloadProofPackButton';

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

describe('DownloadProofPackButton', () => {
  beforeEach(() => {
    jobProofPackPdf.mockReset();
    downloadBlob.mockReset();
  });

  it('downloads the PDF proof pack', async () => {
    const blob = new Blob(['%PDF'], { type: 'application/pdf' });
    jobProofPackPdf.mockResolvedValue({ blob, filename: 'atmosphere-proof-pack-job-1.pdf' });
    render(<DownloadProofPackButton jobId="job-1" />);
    fireEvent.click(screen.getByTestId('download-proof-pack'));
    await waitFor(() => {
      expect(jobProofPackPdf).toHaveBeenCalledWith('job-1', undefined);
      expect(downloadBlob).toHaveBeenCalledWith('atmosphere-proof-pack-job-1.pdf', blob);
    });
  });
});
