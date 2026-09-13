import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConversationPanel } from './ConversationPanel';

describe('ConversationPanel', () => {
  it('renders nothing for silent films', () => {
    const { container } = render(<ConversationPanel conversation={null} />);
    expect(container.querySelector('[data-testid="conversation-panel"]')).toBeNull();
  });

  it('shows an executive brief, key moments, and seekable grounded claims', async () => {
    const user = userEvent.setup();
    const onSeek = vi.fn();
    render(
      <ConversationPanel
        onSeek={onSeek}
        conversation={{
          conversationSource: 'llm',
          conversationModel: 'test-model',
          conversationExecutiveSummary:
            'Homeowner refused cabinet replacement pending insurance. Crew promised to remount the mirror today.',
          conversationSummary: 'Insurance holds cabinets; mirror remount agreed.',
          conversationRooms: ['bathroom', 'hallway'],
          conversationKeyMoments: [
            {
              tSec: 18,
              label: 'Refusal',
              text: 'Do not replace cabinets until insurance approves.',
              quote: 'I do not want you to replace the cabinets unless insurance approves it.',
              confidence: 0.92,
            },
            {
              tSec: 96,
              label: 'Promise',
              text: 'Crew will remount the mirror today.',
              quote: 'We will remount the mirror today',
              confidence: 0.9,
            },
          ],
          conversationAgreementFacts: [
            { text: 'Remount the mirror today.', tSec: 96, quote: 'We will remount the mirror today', confidence: 0.9 },
          ],
          conversationRefusals: [
            {
              text: 'No cabinet replacement without insurance approval.',
              tSec: 18,
              quote: 'I do not want you to replace the cabinets unless insurance approves it.',
              confidence: 0.94,
            },
          ],
          conversationCommitments: [
            {
              text: 'Remount the mirror today.',
              tSec: 96,
              owner: 'Crew',
              quote: 'We will remount the mirror today',
              confidence: 0.9,
            },
          ],
          conversationInsurance: [
            { text: 'Cabinets wait on adjuster / insurance approval.', tSec: 18, confidence: 0.88 },
          ],
          conversationTurns: [
            { tSec: 18, speakerLabel: 'Homeowner', text: 'Do not replace cabinets until insurance approves.' },
            { tSec: 96, speakerLabel: 'Crew', text: 'We will remount the mirror today.' },
          ],
          transcriptText:
            '[0:18] Homeowner: I do not want you to replace the cabinets unless insurance approves it.\n[1:36] Contractor: We will remount the mirror today.',
          transcriptSegments: [
            {
              tSec: 18,
              speakerLabel: 'Homeowner',
              text: 'I do not want you to replace the cabinets unless insurance approves it.',
            },
            {
              tSec: 96,
              speakerLabel: 'Crew',
              text: 'We will remount the mirror today.',
            },
          ],
          conversationPeople: [
            {
              label: 'Homeowner',
              role: 'homeowner',
              firstSeenSec: 18,
              lastSeenSec: 18,
              talking: true,
              evidence: 'Refused cabinet replacement pending insurance.',
              quote: 'I do not want you to replace the cabinets unless insurance approves it.',
            },
            {
              label: 'Crew',
              role: 'crew',
              firstSeenSec: 96,
              talking: true,
              evidence: 'Promised to remount the mirror today.',
              quote: 'We will remount the mirror today',
            },
          ],
        }}
      />,
    );
    expect(screen.getByTestId('conversation-brief').textContent).toMatch(/refused cabinet/i);
    expect(screen.getByTestId('conversation-key-moments').textContent).toMatch(/Refusal/);
    expect(screen.getByTestId('conversation-panel').textContent).toMatch(/Model brief/);
    expect(screen.getByTestId('conversation-panel').textContent).toMatch(/Promises/);
    expect(screen.getByTestId('conversation-panel').textContent).toMatch(/Crew/);
    expect(screen.getByTestId('verbatim-transcript').textContent).toMatch(/Exact transcript/);
    expect(screen.getByTestId('conversation-people').textContent).toMatch(/Homeowner/);
    expect(screen.getByTestId('conversation-people').textContent).toMatch(/Crew/);
    await user.click(screen.getByText(/Crew will remount the mirror today/i));
    expect(onSeek).toHaveBeenCalledWith(96);
  });
});
