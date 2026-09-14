import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ClipAnalysisLayers } from './ClipAnalysisLayers';

const richConversation = {
  conversationSource: 'llm' as const,
  conversationModel: 'test-model',
  conversationExecutiveSummary:
    'Homeowner refused cabinet replacement pending insurance. Crew promised to remount the mirror today.',
  conversationSummary: 'Insurance holds cabinets; mirror remount agreed.',
  conversationRooms: ['bathroom'],
  conversationKeyMoments: [
    {
      tSec: 18,
      label: 'Refusal',
      text: 'Do not replace cabinets until insurance approves.',
      quote: 'I do not want you to replace the cabinets unless insurance approves it.',
    },
  ],
  conversationAgreementFacts: [
    { text: 'Remount the mirror today.', tSec: 96, quote: 'We will remount the mirror today' },
  ],
  conversationRefusals: [
    {
      text: 'No cabinet replacement without insurance approval.',
      tSec: 18,
      quote: 'I do not want you to replace the cabinets unless insurance approves it.',
    },
  ],
  conversationActionItems: [
    { text: 'Remount the mirror today.', tSec: 96, owner: 'Crew' },
  ],
  transcriptSegments: [
    {
      tSec: 18,
      speakerLabel: 'Homeowner',
      text: 'I do not want you to replace the cabinets unless insurance approves it.',
    },
  ],
};

describe('ClipAnalysisLayers', () => {
  it('defaults to Glance + Scan and hides Full evidence body', () => {
    render(
      <ClipAnalysisLayers
        conversation={richConversation}
        people={{
          peopleCount: 1,
          peoplePresent: [{ id: 'p1', label: 'Person 1', role: 'homeowner', appearMoments: [] }],
        }}
        evidenceEntries={[
          { atSeconds: 8, text: 'Bathroom in frame.', type: 'scene' },
          { atSeconds: 18, text: 'Hold cabinets.', type: 'said', speakerLabel: 'Homeowner' },
        ]}
      />,
    );
    expect(screen.getByTestId('analysis-glance').textContent).toMatch(/refused cabinet/i);
    expect(screen.getByTestId('analysis-scan').textContent).toMatch(/Decisions|Next steps|bathroom/i);
    expect(screen.getByTestId('analysis-scan-people').textContent).toMatch(/Person 1/);
    expect(screen.getByTestId('full-evidence')).not.toHaveAttribute('open');
    expect(screen.queryByTestId('evidence-log')).toBeNull();
    expect(screen.queryByTestId('verbatim-transcript')).toBeNull();
  });

  it('expands Full evidence on demand without losing glance/scan', async () => {
    const user = userEvent.setup();
    render(
      <ClipAnalysisLayers
        conversation={richConversation}
        evidenceEntries={[{ atSeconds: 8, text: 'Bathroom in frame.', type: 'scene' }]}
      />,
    );
    expect(screen.getByTestId('analysis-glance')).toBeTruthy();
    await user.click(screen.getByTestId('full-evidence-summary'));
    expect(screen.getByTestId('evidence-log').textContent).toMatch(/Bathroom/);
    expect(screen.getByTestId('verbatim-transcript').textContent).toMatch(/Exact transcript/);
    expect(screen.getByTestId('analysis-glance')).toBeTruthy();
  });

  it('shows an actionable empty state when nothing is on file', () => {
    render(<ClipAnalysisLayers conversation={null} evidenceEntries={[]} />);
    expect(screen.getByTestId('clip-analysis-empty').textContent).toMatch(/Read this video/i);
  });
});
