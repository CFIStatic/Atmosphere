import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConversationPanel } from './ConversationPanel';

describe('ConversationPanel summary states', () => {
  it('shows Summary still processing instead of a brief while the summary is rebuilt', () => {
    render(
      <ConversationPanel
        conversation={{
          summaryState: 'updating',
          transcriptText: '[0:00] her entire life.',
          transcriptSegments: [{ tSec: 0, text: 'her entire life.', speakerLabel: null }],
        }}
      />,
    );
    expect(screen.getByTestId('summary-processing')).toHaveTextContent('Summary still processing.');
    expect(screen.queryByTestId('conversation-brief')).toBeNull();
  });

  it('shows the brief once the summary is fresh', () => {
    render(
      <ConversationPanel
        conversation={{ summaryState: 'fresh', conversationExecutiveSummary: 'Five short affectionate lines.' }}
      />,
    );
    expect(screen.getByTestId('conversation-brief')).toHaveTextContent('Five short affectionate lines.');
    expect(screen.queryByTestId('summary-processing')).toBeNull();
  });
});
