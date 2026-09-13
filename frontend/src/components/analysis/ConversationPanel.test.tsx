import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConversationPanel } from './ConversationPanel';

describe('ConversationPanel', () => {
  it('renders nothing for silent films', () => {
    const { container } = render(<ConversationPanel conversation={null} />);
    expect(container.querySelector('[data-testid="conversation-panel"]')).toBeNull();
    const { container: empty } = render(
      <ConversationPanel conversation={{ conversationSummary: null, conversationTurns: [] }} />,
    );
    expect(empty.querySelector('[data-testid="conversation-panel"]')).toBeNull();
  });

  it('lists summary, agreements, and seekable turns', async () => {
    const user = userEvent.setup();
    const onSeek = vi.fn();
    render(
      <ConversationPanel
        onSeek={onSeek}
        conversation={{
          conversationSummary: 'Homeowner and crew agreed to remount the mirror.',
          conversationRooms: ['bathroom', 'hallway'],
          conversationAgreementFacts: [
            { text: 'Remount the mirror today.', tSec: 96, quote: 'We will remount the mirror today' },
          ],
          conversationConcernFacts: [
            { text: 'Do not cut the hallway above two feet.', tSec: 250 },
          ],
          conversationTurns: [
            { tSec: 18, speakerLabel: 'Homeowner', text: 'Do not replace cabinets until insurance approves.' },
            { tSec: 96, speakerLabel: 'Crew', text: 'We will remount the mirror today.' },
          ],
        }}
      />,
    );
    expect(screen.getByTestId('conversation-panel').textContent).toMatch(/Conversation/);
    expect(screen.getByTestId('conversation-panel').textContent).toMatch(/remount the mirror/i);
    expect(screen.getByTestId('conversation-panel').textContent).toMatch(/bathroom/);
    expect(screen.getByTestId('conversation-turns').textContent).toMatch(/Homeowner/);
    await user.click(screen.getByText(/We will remount the mirror today/i));
    expect(onSeek).toHaveBeenCalledWith(96);
  });
});
