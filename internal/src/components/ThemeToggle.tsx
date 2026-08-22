import { useSyncExternalStore } from 'react';
import {
  cycleThemePreference,
  readThemePreference,
  setThemePreference,
  subscribeTheme,
  themeLabel,
} from '../lib/theme';

function SunIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  );
}

/**
 * One click between light and dark. The icon is the destination: moon in
 * light (switch to dark), sun in dark (switch to light).
 */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeTheme, readThemePreference, () => 'dark' as const);
  const next = cycleThemePreference(theme);
  const label = themeLabel(theme);

  return (
    <button
      type="button"
      onClick={() => setThemePreference(next)}
      aria-label={`Switch to ${themeLabel(next).toLowerCase()} mode`}
      title={`${label} mode. Click for ${themeLabel(next).toLowerCase()}.`}
      className="grid h-8 w-8 place-items-center rounded-full border border-line text-ink-600 transition hover:border-line-strong hover:text-ink-900"
    >
      {next === 'dark' ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}
