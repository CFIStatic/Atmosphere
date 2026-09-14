import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ClaimReadyPacketPanel } from './ClaimReadyPacketPanel';

const jobClaimReadyPacket = vi.fn();

vi.mock('../../lib/api', () => ({
  api: {
    jobClaimReadyPacket: (...args: unknown[]) => jobClaimReadyPacket(...args),
  },
}));

describe('ClaimReadyPacketPanel', () => {
  beforeEach(() => {
    jobClaimReadyPacket.mockReset();
    jobClaimReadyPacket.mockResolvedValue({
      schema: 'atmosphere.claim_ready_packet.v1',
      exportedAt: '2026-09-14T19:00:00.000Z',
      disclaimer: 'Only fields with supporting evidence are filled.',
      job: {
        id: 'job-1',
        number: 12,
        name: 'Cedar Ridge',
        claimNumber: 'CLM-1',
        policyNumber: null,
        lossType: null,
        siteAddress: '4118 Cedar Ridge Dr',
      },
      datesOnSite: ['2026-08-04'],
      parties: [{ id: 'p1', company: 'Delgado Roofing', contactName: 'Hector', trade: 'roofing' }],
      damageObservations: [
        {
          text: 'Damaged decking exposed',
          kind: 'damage',
          sourceProofId: 'pf-1',
          workDate: '2026-08-04',
          atSeconds: 22,
          confidence: 0.9,
        },
      ],
      cause: {
        text: 'Loss caused by the hail storm',
        sourceProofId: 'pf-1',
        workDate: '2026-08-04',
        atSeconds: 40,
        quote: 'caused by the storm',
      },
      photosFrames: [],
      statements: [
        {
          speakerLabel: 'Hector',
          text: 'The hail punched through the decking.',
          quote: null,
          atSeconds: 12,
          proofId: 'pf-1',
          workDate: '2026-08-04',
          privacyRedacted: false,
        },
      ],
      clips: [],
      gaps: [],
      privacy: { redactionsApplied: false, rangeCount: 0 },
    });
  });

  it('renders carrier-ish packet fields from the API', async () => {
    render(<ClaimReadyPacketPanel jobId="job-1" />);
    expect(screen.getByTestId('claim-ready-packet')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/Claim CLM-1/)).toBeInTheDocument();
    });
    expect(screen.getByText('2026-08-04')).toBeInTheDocument();
    expect(screen.getByText(/Delgado Roofing/)).toBeInTheDocument();
    expect(screen.getByText(/Damaged decking exposed/)).toBeInTheDocument();
    expect(screen.getByText(/Loss caused by the hail storm/)).toBeInTheDocument();
    expect(screen.getByTestId('claim-ready-export')).toBeEnabled();
  });
});
