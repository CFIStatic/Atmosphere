import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setThemePreference } from '../lib/theme';
import { ThemeToggle } from './ThemeToggle';

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear();
    setThemePreference('dark');
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('switches the internal site from dark to light', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    const button = screen.getByRole('button', { name: 'Switch to light mode' });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    await user.click(button);

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('atmosphere.theme')).toBe('light');
    expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toBeInTheDocument();
  });
});
