import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ClipSummaryRating } from './ClipSummaryRating';

const SUMMARY = 'Crew pulled the wet drywall in the kitchen.';

describe('ClipSummaryRating', () => {
  it('thumbs up saves a rating without opening the fix box', async () => {
    const onRate = vi.fn().mockResolvedValue(undefined);
    render(<ClipSummaryRating summary={SUMMARY} feedback={null} onRate={onRate} />);
    fireEvent.click(screen.getByTestId('clip-summary-up'));
    await waitFor(() => expect(onRate).toHaveBeenCalledWith(1));
    expect(screen.queryByTestId('clip-summary-fix')).toBeNull();
  });

  it('thumbs down opens the fix box prefilled with the AI text, and saving sends the fix', async () => {
    const onRate = vi.fn().mockResolvedValue(undefined);
    render(<ClipSummaryRating summary={SUMMARY} feedback={null} onRate={onRate} />);
    fireEvent.click(screen.getByTestId('clip-summary-down'));
    await waitFor(() => expect(onRate).toHaveBeenCalledWith(-1));
    const box = (await screen.findByLabelText(/Write what the summary should say/)) as HTMLTextAreaElement;
    expect(box.value).toBe(SUMMARY);
    fireEvent.change(box, { target: { value: 'Crew pulled drywall and set two fans.' } });
    fireEvent.click(screen.getByText('Save fix'));
    await waitFor(() =>
      expect(onRate).toHaveBeenLastCalledWith(-1, { reason: null, correctedText: 'Crew pulled drywall and set two fans.' }),
    );
  });

  it('shows a saved fix and keeps it when a reason is picked', async () => {
    const onRate = vi.fn().mockResolvedValue(undefined);
    render(
      <ClipSummaryRating
        summary={SUMMARY}
        feedback={{ rating: -1, reason: null, correctedText: 'Two fans set.' }}
        onRate={onRate}
      />,
    );
    expect(screen.getByTestId('clip-summary-correction').textContent).toContain('Two fans set.');
    fireEvent.click(screen.getByText('Missed something'));
    await waitFor(() => expect(onRate).toHaveBeenCalledWith(-1, { reason: 'missing', correctedText: 'Two fans set.' }));
  });

  it('says so when saving fails', async () => {
    const onRate = vi.fn().mockRejectedValue(new Error('500'));
    render(<ClipSummaryRating summary={SUMMARY} feedback={null} onRate={onRate} />);
    fireEvent.click(screen.getByTestId('clip-summary-up'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save that');
  });
});
