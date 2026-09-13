import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EvidenceLog } from './EvidenceLog';

describe('EvidenceLog', () => {
  it('lists the complete log and filters Said / Decision / Work', async () => {
    const user = userEvent.setup();
    const onSeek = vi.fn();
    render(
      <EvidenceLog
        onSeek={onSeek}
        entries={[
          { atSeconds: 8, text: 'Hallway in frame.', type: 'scene' },
          { atSeconds: 18, text: 'Do not replace cabinets until insurance approves.', type: 'said', speakerLabel: 'Homeowner' },
          { atSeconds: 48, text: 'Pulling wet drywall.', type: 'work' },
          {
            atSeconds: 96,
            text: 'Agreement: Remount the mirror today.',
            type: 'decision',
            quote: 'We will remount the mirror today',
            owner: 'Crew',
          },
        ]}
      />,
    );
    const root = screen.getByTestId('evidence-log');
    expect(root.textContent).toMatch(/Evidence log/);
    expect(screen.getByTestId('evidence-log-rows').children).toHaveLength(4);

    await user.click(screen.getByRole('tab', { name: /Said/i }));
    expect(screen.getByTestId('evidence-log-rows').children).toHaveLength(1);
    expect(screen.getByTestId('evidence-log-rows').textContent).toMatch(/cabinets/i);

    await user.click(screen.getByRole('tab', { name: /Decision/i }));
    expect(screen.getByTestId('evidence-log-rows').textContent).toMatch(/Remount the mirror/i);
    await user.click(screen.getByText(/Agreement: Remount the mirror today/i));
    expect(onSeek).toHaveBeenCalledWith(96);

    await user.click(screen.getByRole('tab', { name: /Work/i }));
    expect(screen.getByTestId('evidence-log-rows').textContent).toMatch(/drywall/i);
  });
});
