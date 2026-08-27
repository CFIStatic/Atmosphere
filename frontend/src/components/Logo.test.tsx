import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Logo } from './Logo';

/**
 * Guardrail: the Saturn/planet glyph in an orange tile has been deleted more
 * than once and must never return. CI fails if Logo.tsx regresses to it.
 */
describe('Logo brand mark', () => {
  it('is only the five-bar mark (no Saturn/planet, no orange tile, no split wordmark)', () => {
    // Skip NavLink wrapper — this test asserts the mark only.
    const { container, getByText, queryByText } = render(<Logo to={null} />);

    const rects = container.querySelectorAll('rect');
    expect(rects.length).toBe(5);
    expect(container.querySelector('circle')).toBeNull();
    expect(container.querySelector('ellipse')).toBeNull();
    expect(container.querySelector('.bg-brand-500.rounded-lg')).toBeNull();

    expect(getByText('Atmosphere')).toBeInTheDocument();
    expect(queryByText('Atmo')).toBeNull();
    expect(queryByText('sphere')).toBeNull();
  });

  it('renders the bars and name at the default lockup size', () => {
    const { container, getByText } = render(<Logo to={null} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('28');
    expect(svg?.getAttribute('height')).toBe('28');
    expect(getByText('Atmosphere').className).toContain('text-[21px]');
  });

  it('renders the larger lockup used on login', () => {
    const { container, getByText } = render(<Logo to={null} size="lg" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('34');
    expect(svg?.getAttribute('height')).toBe('34');
    expect(getByText('Atmosphere').className).toContain('text-[23px]');
  });

  it('paints ink from the theme token so dark mode is light and light mode is dark', () => {
    const { container, getByText } = render(<Logo to={null} />);
    const lockup = container.querySelector('[data-atmosphere-lockup]');
    expect(lockup?.className).toContain('text-ink-900');
    expect(container.querySelectorAll('rect.fill-current')).toHaveLength(4);
    expect(container.querySelector('rect.fill-brand-500')).not.toBeNull();
    expect(getByText('Atmosphere').className).toContain('text-current');
    expect(container.innerHTML).not.toMatch(/#[0-9A-Fa-f]{3,8}/);
  });
});
