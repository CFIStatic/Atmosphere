import { useT } from '../lib/i18n';
import { setPreference, usePreferences } from '../lib/preferences';
import { cycleThemePreference, setThemePreference } from '../lib/theme';
import { MoonIcon, SunIcon } from './icons';

/**
 * One click between light and dark. The icon is the destination: moon in
 * light (switch to dark), sun in dark (switch to light).
 */
export function ThemeToggle() {
  const t = useT();
  const { theme } = usePreferences();
  const next = cycleThemePreference(theme);
  return (
    <button
      type="button"
      onClick={() => {
        setThemePreference(next);
        setPreference('theme', next);
      }}
      aria-label={next === 'light' ? t('nav.switchToLight') : t('nav.switchToDark')}
      title={t('nav.themeModeHint', {
        current: t(theme === 'light' ? 'theme.light' : 'theme.dark'),
        next: t(next === 'light' ? 'theme.light' : 'theme.dark').toLowerCase(),
      })}
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
