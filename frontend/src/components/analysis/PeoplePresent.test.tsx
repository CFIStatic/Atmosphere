import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PeoplePresentPanel } from './PeoplePresent';

describe('PeoplePresentPanel', () => {
  it('renders people with seekable appearance moments', async () => {
    const onSeek = vi.fn();
    const user = userEvent.setup();
    render(
      <PeoplePresentPanel
        onSeek={onSeek}
        people={{
          peopleCount: 2,
          peopleSource: 'deterministic',
          peoplePresent: [
            {
              id: 'person-1',
              label: 'Person 1 (crew-like)',
              role: 'crew',
              appearance: 'hard hat, high-vis vest',
              appearMoments: [{ tSec: 12, note: 'Enters bathroom' }],
              speakerLabel: 'Crew',
            },
            {
              id: 'person-2',
              label: 'Person 2 (homeowner-like)',
              role: 'homeowner',
              appearance: 'civilian clothes',
              appearMoments: [{ tSec: 18, note: 'Standing by vanity' }],
              speakerLabel: 'Homeowner',
            },
          ],
          peopleSpeakers: [
            { speakerLabel: 'Homeowner', personId: 'person-2', turnCount: 2 },
            { speakerLabel: 'Crew', personId: 'person-1', turnCount: 1 },
          ],
        }}
      />,
    );
    expect(screen.getByTestId('people-present-panel')).toBeInTheDocument();
    expect(screen.getByText('Person 1 (crew-like)')).toBeInTheDocument();
    expect(screen.getByText(/hard hat/i)).toBeInTheDocument();
    expect(screen.getByTestId('people-speakers')).toHaveTextContent(/Homeowner/);
    await user.click(screen.getByText(/Enters bathroom/i));
    expect(onSeek).toHaveBeenCalledWith(12);
  });

  it('renders nothing when nobody is identified', () => {
    const { container } = render(<PeoplePresentPanel people={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
