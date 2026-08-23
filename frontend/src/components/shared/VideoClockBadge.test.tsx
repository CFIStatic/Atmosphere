import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VideoClockBadge } from './VideoClockBadge';

describe('VideoClockBadge', () => {
  it('prints a real length and stays hidden when the time is unknown', () => {
    const { rerender } = render(<VideoClockBadge seconds={94} />);
    expect(screen.getByText('1:34')).toBeInTheDocument();

    rerender(<VideoClockBadge seconds={4620} />);
    expect(screen.getByText('1:17:00')).toBeInTheDocument();

    rerender(<VideoClockBadge seconds={0} />);
    expect(screen.queryByText('0:00')).toBeNull();
    expect(screen.queryByText('—')).toBeNull();

    rerender(<VideoClockBadge seconds={null} />);
    expect(screen.queryByText('—')).toBeNull();
  });
});
