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
    expect(isThemePreference('auto')).toBe(false);
  });

  it('toggles light ↔ dark in one step', () => {
    expect(cycleThemePreference('light')).toBe('dark');
    expect(cycleThemePreference('dark')).toBe('light');
  });

  it('coerces leftover system to the OS palette', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    );
    expect(coerceThemePreference('system')).toBe('dark');
    expect(coerceThemePreference('light')).toBe('light');
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('reads atmosphere.theme, then preferences, then legacy atm-theme', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    );
    expect(readThemePreference()).toBe('light');

    localStorage.setItem('atm-theme', 'light');
    expect(readThemePreference()).toBe('light');

    localStorage.setItem('atmosphere.preferences', JSON.stringify({ theme: 'dark' }));
    expect(readThemePreference()).toBe('dark');

    localStorage.setItem('atmosphere.theme', 'light');
    expect(readThemePreference()).toBe('light');
  });

  it('migrates a stored system value to the current OS palette', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    );
    localStorage.setItem('atmosphere.theme', 'system');
    expect(readThemePreference()).toBe('dark');
  });

  it('labels preferences for the UI', () => {
    expect(themeLabel('light')).toBe('Light');
    expect(themeLabel('dark')).toBe('Dark');
  });
});
