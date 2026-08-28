import { setPreference, usePreferences } from '../lib/preferences';
import { cycleThemePreference, setThemePreference, themeLabel } from '../lib/theme';
import { MoonIcon, SunIcon } from './icons';

/**
 * One click between light and dark. The icon is the destination: moon in
 * light (switch to dark), sun in dark (switch to light).
 */
export function ThemeToggle() {
  const { theme } = usePreferences();
  const next = cycleThemePreference(theme);
  const label = themeLabel(theme);
  return (
    <button
      type="button"
      onClick={() => {
        setThemePreference(next);
        setPreference('theme', next);
      }}
      aria-label={`Switch to ${themeLabel(next).toLowerCase()} mode`}
      title={`${label} mode. Click for ${themeLabel(next).toLowerCase()}.`}
      className="grid h-8 w-8 place-items-center rounded-full border border-line text-ink-600 transition hover:border-line-strong hover:text-ink-900"
    >
      {next === 'dark' ? (
        <MoonIcon width={15} height={15} />
      ) : (
        <SunIcon width={15} height={15} />
      )}
    </button>
  );
}
