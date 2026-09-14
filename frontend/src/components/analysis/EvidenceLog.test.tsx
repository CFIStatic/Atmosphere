import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EvidenceLog, evidenceEntriesFromVideo } from './EvidenceLog';

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

  it('keeps the speaker label separate from the quote body', () => {
    render(
      <EvidenceLog
        entries={[
          {
            atSeconds: 18,
            text: 'I think we should wait on cabinets.',
            type: 'said',
            speakerLabel: 'Friedberg',
          },
        ]}
      />,
    );
    const speaker = screen.getByTestId('evidence-speaker');
    expect(speaker.textContent).toBe('Friedberg');
    const row = screen.getByTestId('evidence-log-rows').textContent || '';
    expect(row).toMatch(/Friedberg/);
    expect(row).toMatch(/I think we should wait/);
    expect(row).not.toMatch(/FriedbergI think/);
  });

  it('highlights the active playhead row without requiring a seek click', () => {
    render(
      <EvidenceLog
        activeAtSeconds={50}
        entries={[
          { atSeconds: 8, text: 'Hallway in frame.', type: 'scene' },
          { atSeconds: 48, text: 'Pulling wet drywall.', type: 'work' },
          { atSeconds: 96, text: 'Done for today.', type: 'activity' },
        ]}
      />,
    );
    const rows = screen.getByTestId('evidence-log-rows').querySelectorAll('li');
    expect(rows[1]).toHaveAttribute('data-active', '1');
    expect(rows[0]).not.toHaveAttribute('data-active');
  });
});

describe('evidenceEntriesFromVideo', () => {
  it('unions Whisper speech into a vision-only evidence log', () => {
    const entries = evidenceEntriesFromVideo({
      evidenceLog: [{ atSeconds: 8, text: 'Hallway in frame.', type: 'scene' }],
      transcriptSegments: [
        {
          tSec: 18,
          text: 'Do not replace cabinets until insurance approves.',
          speakerLabel: 'Homeowner',
        },
      ],
    });
    expect(entries).toHaveLength(2);
    expect(entries[0].type).toBe('scene');
    expect(entries[1]).toMatchObject({
      atSeconds: 18,
      type: 'said',
      speakerLabel: 'Homeowner',
      text: 'Do not replace cabinets until insurance approves.',
    });
  });

  it('builds a said log from the transcript when enrich never ran', () => {
    const entries = evidenceEntriesFromVideo({
      transcriptText: '[0:08] We have not started the subfloor yet.',
    });
    expect(entries).toEqual([
      expect.objectContaining({
        atSeconds: 8,
        type: 'said',
        text: 'We have not started the subfloor yet.',
      }),
    ]);
  });

  it('does not duplicate a mic line already in the stored log', () => {
    const entries = evidenceEntriesFromVideo({
      evidenceLog: [
        {
          atSeconds: 18,
          text: 'Do not replace cabinets until insurance approves.',
          type: 'said',
        },
      ],
      transcriptSegments: [
        { tSec: 18, text: 'Do not replace cabinets until insurance approves.', speakerLabel: 'Homeowner' },
      ],
    });
    expect(entries).toHaveLength(1);
  });
});
