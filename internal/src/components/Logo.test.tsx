import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Logo } from './Logo';

describe('Logo brand mark', () => {
  it('is the five-bar lockup plus Atmosphere — not the retired mountain glyph', () => {
    const { container, getByText } = render(<Logo to={null} />);

    expect(container.querySelectorAll('rect')).toHaveLength(5);
    expect(container.querySelector('circle')).toBeNull();
    expect(container.innerHTML).not.toContain('M7 22.5');
    expect(getByText('Atmosphere')).toBeInTheDocument();
  });

  it('paints ink from the theme token so dark mode is light and light mode is dark', () => {
    const { container, getByText } = render(<Logo to={null} />);
    const lockup = container.querySelector('[data-atmosphere-lockup]');
    expect(lockup?.className).toContain('text-ink-900');
    expect(container.querySelectorAll('rect.fill-current')).toHaveLength(4);
    expect(container.querySelector('rect.fill-brand-500')).not.toBeNull();
    expect(getByText('Atmosphere').className).toContain('text-current');
  });
});
