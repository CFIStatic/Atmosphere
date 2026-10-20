import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TokenTotals, TokenUsageDay } from '../../lib/api';
import { TokenUsageChart } from './TokenUsageChart';
import { emptyTokenTotals } from './tokenUsageModel';

const totals = (partial: Partial<TokenTotals>): TokenTotals => ({
  ...emptyTokenTotals(),
  ...partial,
});

const days: TokenUsageDay[] = [
  {
    day: '2026-10-05',
    ...totals({ totalTokens: 745_213 }),
    byFeature: {
      video_analysis: totals({ totalTokens: 512_400 }),
      chat: totals({ totalTokens: 232_813 }),
      ask: emptyTokenTotals(),
      other: emptyTokenTotals(),
    },
  },
  {
    day: '2026-10-06',
    ...totals({ totalTokens: 9_000 }),
    byFeature: {
      video_analysis: emptyTokenTotals(),
      chat: totals({ totalTokens: 9_000 }),
      ask: emptyTokenTotals(),
      other: emptyTokenTotals(),
    },
  },
];

describe('TokenUsageChart', () => {
  it('shows the day total and each segment on hover, and hides it on leave', () => {
    render(<TokenUsageChart days={days} />);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    fireEvent.pointerEnter(screen.getByTestId('usage-bar-2026-10-05'), { pointerType: 'mouse' });
    const tooltip = screen.getByRole('tooltip');
    expect(within(tooltip).getByText('745,213 tokens')).toBeInTheDocument();
    expect(within(tooltip).getByText('512,400')).toBeInTheDocument();
    expect(within(tooltip).getByText('232,813')).toBeInTheDocument();

    fireEvent.mouseLeave(screen.getByTestId('usage-tooltip').parentElement!);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows a day on tap and hides it when tapping outside the chart', () => {
    render(
      <div>
        <TokenUsageChart days={days} />
        <button type="button">Elsewhere</button>
      </div>,
    );

    fireEvent.click(screen.getByTestId('usage-bar-2026-10-06'));
    expect(within(screen.getByRole('tooltip')).getByText('9,000 tokens')).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
