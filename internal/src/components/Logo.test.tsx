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

  it('renders the bars and name at the corporate lockup size', () => {
    const { container, getByText } = render(<Logo to={null} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('28');
    expect(svg?.getAttribute('height')).toBe('28');
    expect(getByText('Atmosphere').className).toContain('text-[21px]');
    expect(getByText('Atmosphere').className).toContain('font-bold');
    expect(getByText('Atmosphere').className).toContain('tracking-tight');
  });

  it('aligns the wordmark baseline to the orange bar bottom with a 2px nudge', () => {
    const { container, getByText } = render(<Logo to={null} />);
    const lockup = container.querySelector('[data-atmosphere-lockup]');
    expect(lockup?.className).toContain('items-end');
    expect(getByText('Atmosphere').className).toContain('leading-none');
    expect(getByText('Atmosphere').getAttribute('data-word-nudge')).toBe('2');
    expect(getByText('Atmosphere').getAttribute('style')).toContain('translateY(2px)');
    expect(getByText('Atmosphere').getAttribute('style')).toContain('letter-spacing: -0.025em');
  });

  it('paints ink from the theme token; orange base is corporate #F2670C', () => {
    const { container, getByText } = render(<Logo to={null} />);
    const lockup = container.querySelector('[data-atmosphere-lockup]');
    expect(lockup?.className).toContain('text-ink-900');
    expect(container.querySelectorAll('rect.fill-current')).toHaveLength(4);
    const orange = container.querySelectorAll('rect')[4];
    expect(orange?.getAttribute('fill')).toBe('#F2670C');
    expect(getByText('Atmosphere').className).toContain('text-current');
  });
});
