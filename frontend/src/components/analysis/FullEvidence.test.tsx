import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FullEvidence } from './FullEvidence';

describe('FullEvidence', () => {
  it('keeps the evidence log and exact transcript collapsed by default', () => {
    render(
      <FullEvidence
        entries={[
          { atSeconds: 8, text: 'Hallway in frame.', type: 'scene' },
          { atSeconds: 18, text: 'Hold cabinets.', type: 'said', speakerLabel: 'Homeowner' },
        ]}
        transcriptSegments={[
          { tSec: 18, speakerLabel: 'Homeowner', text: 'Hold cabinets until insurance.' },
        ]}
      />,
    );
    const root = screen.getByTestId('full-evidence');
    expect(root).not.toHaveAttribute('open');
    expect(screen.getByTestId('full-evidence-summary').textContent).toMatch(/Full evidence/i);
    expect(screen.queryByTestId('evidence-log')).toBeNull();
    expect(screen.queryByTestId('verbatim-transcript')).toBeNull();
  });

  it('reveals evidence log and exact transcript when expanded', async () => {
    const user = userEvent.setup();
    const onSeek = vi.fn();
    render(
      <FullEvidence
        onSeek={onSeek}
        entries={[{ atSeconds: 48, text: 'Pulling wet drywall.', type: 'work' }]}
        transcriptSegments={[
          { tSec: 96, speakerLabel: 'Crew', text: 'We will remount the mirror today.' },
        ]}
      />,
    );
    await user.click(screen.getByTestId('full-evidence-summary'));
    expect(screen.getByTestId('evidence-log').textContent).toMatch(/drywall/i);
    expect(screen.getByTestId('verbatim-transcript').textContent).toMatch(/remount the mirror/i);
    await user.click(screen.getByText(/Pulling wet drywall/i));
    expect(onSeek).toHaveBeenCalledWith(48);
  });

  it('supports defaultOpen for expanded proof views', () => {
    render(
      <FullEvidence
        defaultOpen
        entries={[{ atSeconds: 1, text: 'Scene open.', type: 'scene' }]}
      />,
    );
    expect(screen.getByTestId('full-evidence')).toHaveAttribute('open');
    expect(screen.getByTestId('evidence-log')).toBeTruthy();
  });
});
