import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProgressShareGuestView } from '../lib/api';

const progressShareGuest = vi.fn();
const progressShareVideo = vi.fn();

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      progressShareGuest: (...args: unknown[]) => progressShareGuest(...args),
      progressShareVideo: (...args: unknown[]) => progressShareVideo(...args),
    },
  };
});

import { JobProgressGuestPage } from './JobProgressGuestPage';

const view: ProgressShareGuestView = {
  share: {
    label: 'Cedar Ridge HOA — homeowner',
    expiresAt: '2026-10-01T00:00:00Z',
    recipientEmail: 'board@cedarridgehoa.org',
  },
  org: { name: 'Ortiz Restoration' },
  job: {
    id: 'job-1038',
    title: 'Cedar Ridge — storm damage, roof tarp + rebuild',
    jobNumber: 1038,
    claimNumber: 'CLM-88396',
    status: 'in_progress',
  },
  brief: {
    id: 'br-4',
    revision: 4,
    facts: { 'Site address': '2214 Cedar Ridge Dr, Round Rock TX' },
    note: 'Skylights removed from scope.',
  },
  scope: [
    {
      id: 'sc-2',
      party_id: null,
      state: 'excluded',
      title: 'Do not remove the skylights',
      detail: null,
      amount: null,
      reason: 'Carrier declined them on revision 4.',
      revision: 4,
      decided_at: null,
      created_at: '2026-08-04T08:05:00Z',
    },
    {
      id: 'sc-4',
      party_id: 'pty-2',
      state: 'included',
      title: 'Tear off and replace roof — architectural shingle, 30yr',
      detail: null,
      amount: null,
      reason: null,
      revision: 4,
      decided_at: null,
      created_at: '2026-07-19T09:05:00Z',
    },
  ],
  progress: {
    scopePct: 0,
    scopeApproved: 0,
    scopeTotal: 1,
    daysLogged: 1,
    verifiedDays: 1,
    inProgress: 0,
  },
  proof: {
    days: [
      {
        partyId: 'pty-2',
        company: 'Delgado Roofing',
        workDate: '2026-08-05',
        hasBefore: true,
        hasAfter: true,
        checks: [],
        contradicted: false,
        summary: 'North slope stripped and re-shingled.',
        payable: true,
        payableBecause: 'Before and after on file.',
        accepted: true,
        rejected: false,
        aiSummary: 'The north slope is stripped to decking with new shingles.',
        aiFindings: null,
        materialChange: 'significant',
        analysisStatus: 'done',
        analysisError: null,
        reports: { before: null, after: null },
        proofIds: ['pf-1', 'pf-2'],
      },
    ],
    videos: [
      {
        id: 'pf-2',
        partyId: 'pty-2',
        company: 'Delgado Roofing',
        workDate: '2026-08-05',
        phase: 'after',
        durationSeconds: 94,
        analysisStatus: 'done',
        narrationStatus: 'done',
        transcriptStatus: 'done',
        transcriptError: null,
        aiSummary: 'The north slope is stripped to decking.',
        heardOnMic: 'Homeowner asked us not to touch the skylights.',
      },
    ],
    counts: { days: 1, videos: 1, payable: 1, contradicted: 0, awaitingAfter: 0 },
    siteKnown: true,
  },
};

function renderGuest() {
  return render(
    <MemoryRouter initialEntries={['/progress/demo-homeowner']}>
      <Routes>
        <Route path="/progress/:token" element={<JobProgressGuestPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('JobProgressGuestPage', () => {
  beforeEach(() => {
    progressShareGuest.mockReset();
    progressShareVideo.mockReset();
    progressShareGuest.mockResolvedValue(view);
  });

  it('shows the job file, do-nots, and every recording without asking for an account', async () => {
    renderGuest();

    expect(await screen.findByText('Job file')).toBeInTheDocument();
    expect(screen.getByText('Ortiz Restoration')).toBeInTheDocument();
    expect(screen.getByText('Cedar Ridge HOA — homeowner')).toBeInTheDocument();
    expect(screen.getByText('Skylights removed from scope.')).toBeInTheDocument();
    expect(screen.getAllByText('2214 Cedar Ridge Dr, Round Rock TX').length).toBeGreaterThan(0);
    expect(screen.getByText('Do not remove the skylights')).toBeInTheDocument();
    expect(screen.getByText('Carrier declined them on revision 4.')).toBeInTheDocument();
    expect(screen.getByText('All recordings')).toBeInTheDocument();
    expect(screen.getByText('The north slope is stripped to decking.')).toBeInTheDocument();
    expect(screen.queryByText(/sign in/i)).toBeNull();
    expect(screen.queryByText(/create.*account/i)).toBeNull();
  });
});
