import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ShowDispute } from './ShowDispute';
import type { DisputeMoment } from '../../lib/api';

const moments: DisputeMoment[] = [
  {
    id: 'scope:skylight',
    kind: 'scope',
    severity: 'high',
    title: 'Conflicts with excluded scope — Do not touch the skylights',
    detail: 'Hands on the skylight flashing; tools in frame.',
    proofId: 'pf-x',
    seekSeconds: 41,
    workDate: '2026-08-08',
    partyId: 'pty-2',
    company: 'Delgado Roofing',
    phase: 'after',
    relatedProofIds: ['pf-x'],
    scopeTitle: 'Do not touch the skylights',
  },
];

describe('ShowDispute', () => {
  it('opens the disputed moments and seeks on tap', async () => {
    const user = userEvent.setup();
    const onSeek = vi.fn();
    render(<ShowDispute disputes={moments} onSeek={onSeek} />);

    expect(screen.getByRole('button', { name: /Show me the dispute/i })).toBeInTheDocument();
    expect(screen.queryByTestId('dispute-list')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Show me the dispute/i }));
    expect(screen.getByTestId('dispute-list').textContent).toMatch(/skylight/i);
    expect(screen.getByText('0:41')).toBeInTheDocument();

    await user.click(screen.getByText(/Conflicts with excluded scope/i));
    expect(onSeek).toHaveBeenCalledWith(moments[0]);
  });

  it('says none when the file is clean', async () => {
    const user = userEvent.setup();
    render(<ShowDispute disputes={[]} />);
    await user.click(screen.getByRole('button', { name: /Show me the dispute/i }));
    expect(screen.getByText(/Nothing on this file conflicts/i)).toBeInTheDocument();
  });
});
