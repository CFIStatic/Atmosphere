import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Logo } from './Logo';

/**
 * Guardrail: the Saturn/planet glyph in an orange tile has been deleted more
 * than once and must never return. CI fails if Logo.tsx regresses to it.
 */
describe('Logo brand mark', () => {
  it('is only the five-bar mark (no Saturn/planet, no orange tile, no split wordmark)', () => {
    const { container, getByText, queryByText } = render(<Logo />);

    const rects = container.querySelectorAll('rect');
    expect(rects.length).toBe(5);
    expect(container.querySelector('circle')).toBeNull();
    expect(container.querySelector('ellipse')).toBeNull();
    expect(container.querySelector('.bg-brand-500.rounded-lg')).toBeNull();

    expect(getByText('Atmosphere')).toBeInTheDocument();
    expect(queryByText('Atmo')).toBeNull();
    expect(queryByText('sphere')).toBeNull();
  });
});
