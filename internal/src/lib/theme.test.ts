import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  coerceThemePreference,
  cycleThemePreference,
  isThemePreference,
  readThemePreference,
  resolveTheme,
  themeLabel,
} from './theme';

describe('theme preference', () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('accepts light and dark only', () => {
    expect(isThemePreference('light')).toBe(true);
    expect(isThemePreference('dark')).toBe(true);
    expect(isThemePreference('system')).toBe(false);
  });

  it('toggles light ↔ dark in one step', () => {
    expect(cycleThemePreference('light')).toBe('dark');
    expect(cycleThemePreference('dark')).toBe('light');
  });

  it('reads atmosphere.theme', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    localStorage.setItem('atmosphere.theme', 'light');
    expect(readThemePreference()).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
    expect(coerceThemePreference('light')).toBe('light');
  });

  it('labels preferences for the toggle', () => {
    expect(themeLabel('light')).toBe('Light');
    expect(themeLabel('dark')).toBe('Dark');
  });
});
