import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TABLE_CLIP_ID } from './tiffanyJobFixture';
import { buildJobTimeline, type TimelineSource } from './jobTimeline';
import {
  TIFFANY_JOB_ID,
  tiffanyAccess,
  tiffanyCustody,
  tiffanyLive,
  tiffanyMembers,
  tiffanyMemory,
  tiffanyPosters,
  tiffanyProofs,
  tiffanyRecord,
  tiffanyScopeDoc,
  tiffanyShares,
} from './tiffanyJobFixture';

const proofVideoUrl = vi.hoisted(() => vi.fn());
const jobProofs = vi.hoisted(() => vi.fn());

vi.mock('../../lib/api', () => ({
  api: {
    proofVideoUrl,
    jobProofs,
    jobLiveSessions: vi.fn(),
    getMemory: vi.fn(),
    jobCustodyExport: vi.fn(),
    evidenceShares: vi.fn(),
    jobAccessRoster: vi.fn(),
    scopeDocument: vi.fn(),
    evidenceLibrary: vi.fn(),
    getJobMentionMembers: vi.fn(),
    getMembers: vi.fn(),
  },
}));

import { JobTimeline } from './JobTimeline';

const source: TimelineSource = {
  jobId: TIFFANY_JOB_ID,
  record: tiffanyRecord,
  proofs: tiffanyProofs,
  memory: tiffanyMemory,
  custody: tiffanyCustody,
  shares: tiffanyShares,
  access: tiffanyAccess,
  scopeDoc: tiffanyScopeDoc,
  liveSessions: tiffanyLive,
  posters: tiffanyPosters,
  members: tiffanyMembers,
};

describe('JobTimeline', () => {
  beforeEach(() => {
    proofVideoUrl.mockReset();
    proofVideoUrl.mockResolvedValue({ url: 'https://signed.test/clip.mp4', expiresInSeconds: 60 });
    jobProofs.mockReset();
  });

  it('shows a loading state while the job is still being read', () => {
    jobProofs.mockReturnValue(new Promise(() => undefined));
    render(<JobTimeline jobId="job-1038" record={null} office={false} />);
    expect(screen.getByTestId('job-timeline-loading')).toHaveTextContent('Loading the timeline');
  });

  it('shows an empty state when the job has no records', async () => {
    jobProofs.mockResolvedValue({
      days: [],
      videos: [],
      counts: { days: 0, payable: 0, contradicted: 0, awaitingAfter: 0 },
      siteKnown: false,
    });
    render(<JobTimeline jobId="job-1038" record={null} office={false} />);
    expect(await screen.findByTestId('job-timeline-empty')).toHaveTextContent('Nothing on this job yet.');
    expect(proofVideoUrl).not.toHaveBeenCalled();
  });

  it('renders the Tiffany stand-in newest first, with live rows pinned', async () => {
    const user = userEvent.setup();
    const events = buildJobTimeline(source);
    const { rerender } = render(
      <JobTimeline jobId={TIFFANY_JOB_ID} record={tiffanyRecord} office events={events} />,
    );

    expect(screen.getByRole('heading', { name: 'Timeline' })).toBeInTheDocument();
    expect(screen.getByText('Now')).toBeInTheDocument();
    expect(screen.getByText('El Presidente recorded a clip lasting 34 seconds in the dining room.')).toBeInTheDocument();
    expect(screen.getByText('11:37 AM CT')).toBeInTheDocument();
    expect(screen.getByText(/Monday, September 21, 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/4412/)).not.toBeInTheDocument();
    expect(screen.queryByText(/toddler/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/entire life/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Notes' })).not.toBeInTheDocument();
    expect(proofVideoUrl).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Clips' }));
    expect(screen.getByText('El Presidente recorded a clip lasting 34 seconds in the dining room.')).toBeInTheDocument();
    expect(screen.queryByText(/renamed the job/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'All' }));
    await user.selectOptions(screen.getByLabelText('Person'), 'El Presidente');
    expect(screen.getByText(/opened job #12/)).toBeInTheDocument();

    await user.click(screen.getByTestId('timeline-order'));
    expect(screen.getByTestId('timeline-order')).toHaveTextContent('Oldest first');
    expect(screen.getByText('Now')).toBeInTheDocument();

    await user.click(screen.getByTestId(`timeline-thumb-clip:${TABLE_CLIP_ID}`));
    await waitFor(() => expect(proofVideoUrl).toHaveBeenCalledTimes(1));
    expect(proofVideoUrl).toHaveBeenCalledWith(TABLE_CLIP_ID);
    expect(await screen.findByTestId('timeline-player')).toBeInTheDocument();

    rerender(<JobTimeline jobId="job-other" record={null} office events={[]} />);
    expect(screen.queryByTestId('timeline-player')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Person')).toHaveValue('all');
    expect(screen.getByTestId('job-timeline-empty')).toBeInTheDocument();
  });
});
