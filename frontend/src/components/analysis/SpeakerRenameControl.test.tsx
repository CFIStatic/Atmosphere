import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SpeakerRenameControl } from './SpeakerRenameControl';

describe('SpeakerRenameControl', () => {
  it('shows the guess with a closed parenthesis and keeps the fact label', async () => {
    const onSave = vi.fn();
    render(
      <SpeakerRenameControl
        speaker={{ speakerLabel: 'Speaker 3', role: 'homeowner', roleStatus: 'tentative', quote: 'my house' }}
        onSave={onSave}
      />,
    );
    const shown = screen.getByTestId('speaker-ui-label').textContent ?? '';
    expect(shown).toBe('Speaker 3 (likely homeowner)');
    expect(shown.split('(').length).toBe(shown.split(')').length);
    expect(screen.getByTestId('speaker-fact-label')).toHaveTextContent('Evidence keeps Speaker 3');
    await userEvent.click(screen.getByTestId('speaker-correct'));
    await userEvent.type(screen.getByTestId('speaker-rename-name'), 'Marco');
    await userEvent.click(screen.getByTestId('speaker-rename-save'));
    expect(onSave).toHaveBeenCalledWith({ speakerLabel: 'Speaker 3', displayName: 'Marco', role: undefined });
  });
});
