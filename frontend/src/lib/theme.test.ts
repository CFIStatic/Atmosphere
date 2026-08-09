import { afterEach, describe, expect, it, vi } from 'vitest';
import {
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

  it('accepts light, dark, and system only', () => {
    expect(isThemePreference('light')).toBe(true);
    expect(isThemePreference('dark')).toBe(true);
    expect(isThemePreference('system')).toBe(true);
    expect(isThemePreference('auto')).toBe(false);
  });

  it('cycles system → light → dark → system', () => {
    expect(cycleThemePreference('system')).toBe('light');
    expect(cycleThemePreference('light')).toBe('dark');
    expect(cycleThemePreference('dark')).toBe('system');
  });

  it('resolves system from the OS media query', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    );
    expect(resolveTheme('system')).toBe('dark');
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('reads atmosphere.theme, then preferences, then legacy atm-theme', () => {
    expect(readThemePreference()).toBe('system');

    localStorage.setItem('atm-theme', 'light');
    expect(readThemePreference()).toBe('light');

    localStorage.setItem('atmosphere.preferences', JSON.stringify({ theme: 'dark' }));
    expect(readThemePreference()).toBe('dark');

    localStorage.setItem('atmosphere.theme', 'system');
    expect(readThemePreference()).toBe('system');
  });

  it('labels preferences for the UI', () => {
    expect(themeLabel('system')).toBe('System');
    expect(themeLabel('light')).toBe('Light');
    expect(themeLabel('dark')).toBe('Dark');
  });
});
