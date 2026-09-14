import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PunchListPanel } from './PunchListPanel';
import type { PunchListItem } from '../../lib/api';

const item = (over: Partial<PunchListItem> = {}): PunchListItem => ({
  id: 'p|action|remount',
  fingerprint: 'p|action|remount',
  text: 'Remount the chest cam',
  detail: null,
  quote: null,
  ownerLabel: 'Crew',
  source: 'action',
  seekSeconds: 94,
  proofId: 'proof-1',
  workDate: '2026-08-05',
  company: 'Delgado',
  partyId: 'pty',
  phase: 'after',
  scopeTitle: null,
  assignedTaskId: null,
  ...over,
});

describe('PunchListPanel', () => {
  it('hides when there are no open items from film', () => {
    const { container } = render(<PunchListPanel items={[]} jobId="job-1" />);
    expect(container.firstChild).toBeNull();
  });

  it('shows seek and assign affordances for an open item', () => {
    const onSeek = vi.fn();
    render(<PunchListPanel items={[item()]} jobId="job-1" onSeek={onSeek} />);
    expect(screen.getByTestId('punch-list-panel')).toBeTruthy();
    expect(screen.getByTestId('punch-seek-p|action|remount')).toBeTruthy();
    expect(screen.getByTestId('punch-assign-p|action|remount')).toBeTruthy();
  });

  it('shows Assigned instead of assign when already linked', () => {
    render(
      <PunchListPanel items={[item({ assignedTaskId: 'task-1' })]} jobId="job-1" />,
    );
    expect(screen.getByText('Assigned')).toBeTruthy();
    expect(screen.queryByTestId('punch-assign-p|action|remount')).toBeNull();
  });
});
