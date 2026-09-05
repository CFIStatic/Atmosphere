import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProgressShareGuestView } from '../lib/api';

const progressShareGuest = vi.fn();
const progressShareVideo = vi.fn();
const progressShareAsk = vi.fn();

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      progressShareGuest: (...args: unknown[]) => progressShareGuest(...args),
      progressShareVideo: (...args: unknown[]) => progressShareVideo(...args),
      progressShareAsk: (...args: unknown[]) => progressShareAsk(...args),
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

function renderGuest(path = '/progress/demo-homeowner') {
  return render(
    <MemoryRouter initialEntries={[path]}>
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
    progressShareAsk.mockReset();
    progressShareGuest.mockResolvedValue(view);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the job file, do-nots, and every recording without asking for an account', async () => {
    renderGuest();

    expect(await screen.findByText('Job file')).toBeInTheDocument();
    expect(screen.getByText('Ortiz Restoration')).toBeInTheDocument();
    expect(screen.getByText('board@cedarridgehoa.org')).toBeInTheDocument();
    expect(screen.getByText('Skylights removed from scope.')).toBeInTheDocument();
    expect(screen.getAllByText('2214 Cedar Ridge Dr, Round Rock TX').length).toBeGreaterThan(0);
    expect(screen.getByText('Do not remove the skylights')).toBeInTheDocument();
    expect(screen.getByText('Carrier declined them on revision 4.')).toBeInTheDocument();
    expect(await screen.findByText('All recordings')).toBeInTheDocument();
    expect(
      await screen.findByText('The north slope is stripped to decking.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/sign in/i)).toBeNull();
    expect(screen.queryByText(/create.*account/i)).toBeNull();
    expect(screen.getByRole('heading', { name: 'Ask this job' })).toBeInTheDocument();
  });

  it('opens Ask when the emailed Ask link is used', async () => {
    renderGuest('/progress/demo-homeowner?ask=1');

    expect(await screen.findByRole('heading', { name: 'Ask this job' })).toBeInTheDocument();
    expect(screen.getByTestId('job-file-ask')).toBeInTheDocument();
  });

  it('puts Atmosphere on the left and stacks the job file plus share email on the right', async () => {
    const { container } = renderGuest();

    expect(await screen.findByText('Job file')).toBeInTheDocument();
    const header = container.querySelector('header');
    expect(header).toBeTruthy();
    const row = header!.firstElementChild as HTMLElement;
    expect(row.className).toContain('justify-between');
    expect(row.firstElementChild).toHaveAttribute('data-atmosphere-lockup');
    const meta = row.lastElementChild as HTMLElement;
    expect(meta.className).toContain('text-right');
    expect(meta).toHaveTextContent('Job file');
    expect(meta).toHaveTextContent('Ortiz Restoration');
    expect(meta).toHaveTextContent('Shared with');
    expect(meta).toHaveTextContent('board@cedarridgehoa.org');
    expect(meta).not.toHaveTextContent('Cedar Ridge HOA — homeowner');
  });
});
