import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { setPreference } from '../lib/preferences';
import { applyResolvedTheme } from '../lib/theme';
import { ThemeToggle } from './ThemeToggle';

describe('ThemeToggle', () => {
  beforeEach(() => {
    setPreference('theme', 'light');
    setPreference('theme', 'dark');
    applyResolvedTheme('dark');
  });

  it('flips the document palette between dark and light', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    await user.click(screen.getByRole('button', { name: 'Switch to light mode' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    await user.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
