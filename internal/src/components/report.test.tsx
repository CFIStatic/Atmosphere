import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Delta, KpiStrip, LineChart, NotTracked } from './report';

describe('report primitives', () => {
  it('colours deltas by direction and what counts as good', () => {
    const { rerender } = render(<Delta value={4.24} />);
    expect(screen.getByText('+4.2%').className).toContain('text-success-600');
    rerender(<Delta value={4.24} goodWhen="down" />);
    expect(screen.getByText('+4.2%').className).toContain('text-danger-600');
    rerender(<Delta value={-1.5} format="pts" />);
    expect(screen.getByText('−1.5 pts').className).toContain('text-danger-600');
    rerender(<Delta value={null} />);
    expect(screen.getByText('n/a')).toBeInTheDocument();
  });

  it('renders KPI labels with units', () => {
    render(<KpiStrip items={[{ label: 'MRR', unit: 'USD, as of Oct 2, 2026', value: '$12k' }]} />);
    expect(screen.getByText('MRR')).toBeInTheDocument();
    expect(screen.getByText('USD, as of Oct 2, 2026')).toBeInTheDocument();
    expect(screen.getByText('$12k')).toBeInTheDocument();
  });

  it('says so when there is not enough history to chart', () => {
    render(<LineChart ariaLabel="x" format={String} series={[{ label: 'a', points: [{ x: '1', y: 1 }] }]} />);
    expect(screen.getByText(/Not enough history/)).toBeInTheDocument();
  });

  it('labels untracked metrics honestly', () => {
    render(<NotTracked>No rating control</NotTracked>);
    expect(screen.getByTestId('not-tracked').textContent).toBe('Not tracked yet. No rating control');
  });
});
