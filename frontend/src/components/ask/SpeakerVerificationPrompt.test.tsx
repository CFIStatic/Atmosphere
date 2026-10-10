import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SpeakerVerificationPrompt } from './SpeakerVerificationPrompt';

const verification = {
  id: 'v1',
  proofId: 'clip-1',
  question: 'Is Speaker 2 Marco? Heard at 0:42 in “North slope walkthrough”.',
  speakerLabel: 'Speaker 2',
  clipTitle: 'North slope walkthrough',
  tSec: 42,
  candidateName: 'Marco',
  role: null,
  quote: "I'm Marco",
};

describe('SpeakerVerificationPrompt', () => {
  it('offers yes, no, and someone else', async () => {
    const onAnswer = vi.fn();
    render(<SpeakerVerificationPrompt verification={verification} onAnswer={onAnswer} />);
    expect(screen.getByTestId('speaker-verification-question')).toHaveTextContent(
      'Is Speaker 2 Marco? Heard at 0:42 in “North slope walkthrough”.',
    );
    expect(screen.getByText(/I'm Marco/)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('speaker-verify-yes'));
    expect(onAnswer).toHaveBeenCalledWith({ id: 'v1', answer: 'yes' });
    await userEvent.click(screen.getByTestId('speaker-verify-other'));
    await userEvent.type(screen.getByTestId('speaker-verify-name'), 'Elena');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onAnswer).toHaveBeenCalledWith({ id: 'v1', answer: 'other', displayName: 'Elena', role: undefined });
  });
});
