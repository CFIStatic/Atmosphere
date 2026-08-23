import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ProofDay, ProofResponse } from '../../lib/api';
import { ProofOfWork } from './ProofOfWork';

function day(partial: Partial<ProofDay> & Pick<ProofDay, 'partyId' | 'workDate'>): ProofDay {
  return {
    company: 'Delgado Roofing',
    hasBefore: true,
    hasAfter: true,
    checks: [],
    contradicted: false,
    summary: 'North slope stripped and underlayment down.',
    payable: true,
    payableBecause: 'Checks passed.',
    accepted: true,
    rejected: false,
    aiSummary: null,
    aiFindings: null,
    proofIds: [],
    ...partial,
  };
}

const data: ProofResponse = {
  siteKnown: true,
  counts: { days: 1, payable: 0, contradicted: 0, awaitingAfter: 0, analysing: 0 },
  days: [
    day({
      partyId: 'pty-2',
      workDate: '2026-08-05',
      proofIds: ['pf-1', 'pf-2'],
      proofClips: [
        { id: 'pf-1', durationSeconds: 68 },
        { id: 'pf-2', durationSeconds: 94 },
      ],
    }),
  ],
};

describe('ProofOfWork field video clocks', () => {
  it('prints clip lengths on the day row and on each play tile', async () => {
    const user = userEvent.setup();
    render(<ProofOfWork readOnly initialData={data} />);

    expect(screen.getByText('1:08 · 1:34')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Delgado Roofing/i }));

    expect(screen.getAllByText('1:08').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1:34').length).toBeGreaterThan(0);
    expect(screen.queryByText('0:00')).toBeNull();
  });
});
