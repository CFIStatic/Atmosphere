import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EventTimeline } from './EventTimeline';

describe('EventTimeline', () => {
  it('lists event times and seeks on click — no 0:00 dump required', async () => {
    const user = userEvent.setup();
    const onSeek = vi.fn();
    render(
      <EventTimeline
        events={[
          { atSeconds: 8, text: 'Two monitors come into view.', type: 'scene' },
          { atSeconds: 18, text: 'A spreadsheet is readable.', type: 'activity' },
        ]}
        onSeek={onSeek}
      />,
    );
    expect(screen.getByTestId('event-timeline').textContent).toMatch(/0:08/);
    expect(screen.getByTestId('event-timeline').textContent).toMatch(/0:18/);
    expect(screen.getByTestId('event-timeline').textContent).not.toMatch(/0:00/);
    await user.click(screen.getByText(/spreadsheet/i));
    expect(onSeek).toHaveBeenCalledWith(18);
  });

  it('keeps failed and pending states quiet', () => {
    const { rerender } = render(<EventTimeline events={[]} status="pending" />);
    expect(screen.getByText(/Reading this clip/i)).toBeInTheDocument();
    rerender(<EventTimeline events={[]} status="failed" />);
    expect(screen.getByText(/Reading failed/i)).toBeInTheDocument();
  });
});
