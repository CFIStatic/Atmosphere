import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/api', () => ({
  api: {
    jobEvidence: () =>
      Promise.resolve({
        items: [
          {
            id: 'pf-2',
            partyId: 'pty-2',
            company: 'Delgado Roofing',
            trade: 'roofing',
            workDate: '2026-08-05',
            phase: 'after',
            category: 'after',
            title: 'After — Aug 05',
            tags: ['north slope'],
            durationSeconds: 94,
            byteSize: 121_800_000,
            capturedAt: '2026-08-05T20:46:00Z',
            receivedAt: '2026-08-05T20:51:00Z',
            hasLocation: true,
            state: 'analysed',
            checks: [],
            aiSummary: null,
            legalHold: false,
            retentionUntil: '2028-08-05',
            contentHash: 'abc',
            viewCount: 2,
            lastViewedAt: '2026-08-06T07:41:00Z',
          },
          {
            id: 'pf-zero',
            partyId: 'pty-2',
            company: 'Delgado Roofing',
            trade: 'roofing',
            workDate: '2026-08-06',
            phase: 'before',
            category: 'before',
            title: 'Before — Aug 06',
            tags: [],
            durationSeconds: 0,
            byteSize: 1_000,
            capturedAt: null,
            receivedAt: '2026-08-06T12:00:00Z',
            hasLocation: false,
            state: 'checked',
            checks: [],
            aiSummary: null,
            legalHold: false,
            retentionUntil: null,
            contentHash: null,
            viewCount: 0,
            lastViewedAt: null,
          },
        ],
        counts: { items: 2, onHold: 0, neverViewed: 1 },
      }),
  },
}));

import { EvidenceLocker } from './EvidenceLocker';

describe('EvidenceLocker length column', () => {
  it('prints a real clock and hides a stored 0:00', async () => {
    render(<EvidenceLocker jobId="job-1038" />);

    await waitFor(() => {
      expect(screen.getByText('1:34')).toBeInTheDocument();
    });
    expect(screen.getByText('After — Aug 05')).toBeInTheDocument();
    expect(screen.queryByText('0:00')).toBeNull();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
