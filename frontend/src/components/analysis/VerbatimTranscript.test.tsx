import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { VerbatimTranscript } from './VerbatimTranscript';

describe('VerbatimTranscript', () => {
  it('lists exact words, searches, and seeks', async () => {
    const user = userEvent.setup();
    const onSeek = vi.fn();
    render(
      <VerbatimTranscript
        onSeek={onSeek}
        segments={[
          {
            tSec: 18,
            speakerLabel: 'Homeowner',
            text: 'I do not want you to replace the cabinets unless insurance approves it.',
          },
          {
            tSec: 96,
            speakerLabel: 'Crew',
            text: 'We will remount the mirror today and leave the cabinets until the adjuster says go ahead.',
          },
        ]}
      />,
    );
    expect(screen.getByTestId('verbatim-transcript').textContent).toMatch(/Exact transcript/);
    expect(screen.getByTestId('verbatim-lines').textContent).toMatch(/unless insurance approves it/);
    await user.type(screen.getByTestId('verbatim-search'), 'mirror');
    expect(screen.getByTestId('verbatim-lines').children).toHaveLength(1);
    await user.click(screen.getByText(/We will remount the mirror today/i));
    expect(onSeek).toHaveBeenCalledWith(96);
  });
});
