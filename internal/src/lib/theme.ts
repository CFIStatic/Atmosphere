/**
 * Light / dark appearance for Atmosphere Internal.
 *
 * Same storage keys as the office app (`atmosphere.theme`) so a choice can
 * follow the person across Atmosphere surfaces on the same origin.
 */

export type ThemePreference = 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'atmosphere.theme';

const PREFERENCES_STORAGE_KEY = 'atmosphere.preferences';
const LEGACY_WEB_THEME_KEY = 'atm-theme';

const themeListeners = new Set<() => void>();
let storageListening = false;

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark';
}

export function systemResolvedTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'dark';
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'dark';
  }
}

export function coerceThemePreference(value: unknown): ThemePreference {
  if (isThemePreference(value)) return value;
  return systemResolvedTheme();
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference;
}

export function cycleThemePreference(current: ThemePreference): ThemePreference {
  return current === 'dark' ? 'light' : 'dark';
}

export function themeLabel(preference: ThemePreference): string {
  return preference === 'light' ? 'Light' : 'Dark';
}

export function readThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'dark';
  try {
    const direct = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (direct != null) return coerceThemePreference(direct);

    const prefsRaw = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (prefsRaw) {
      const parsed = JSON.parse(prefsRaw) as { theme?: unknown };
      if (parsed.theme != null) return coerceThemePreference(parsed.theme);
    }

    const legacy = window.localStorage.getItem(LEGACY_WEB_THEME_KEY);
    if (legacy === 'light' || legacy === 'dark') return legacy;
  } catch {
    /* private mode / corrupt JSON */
  }
  return systemResolvedTheme();
}

export function applyResolvedTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference);
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', resolved);
    document.documentElement.setAttribute('data-theme-preference', resolved);
  }
  return resolved;
}

export function persistThemePreference(preference: ThemePreference): void {
  if (typeof window === 'undefined') return;
  const stored = coerceThemePreference(preference);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, stored);

    let prefs: Record<string, unknown> = {};
    try {
      const raw = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
      if (raw) prefs = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      prefs = {};
    }
    window.localStorage.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({ ...prefs, theme: stored }),
    );
    window.localStorage.setItem(LEGACY_WEB_THEME_KEY, stored);
  } catch {
    /* storage unavailable */
  }
}

function ensureStorageWatcher(): void {
  if (typeof window === 'undefined' || storageListening) return;
  storageListening = true;
  window.addEventListener('storage', (event) => {
    if (
      event.key !== THEME_STORAGE_KEY &&
      event.key !== PREFERENCES_STORAGE_KEY &&
      event.key !== LEGACY_WEB_THEME_KEY
    ) {
      return;
    }
    const preference = readThemePreference();
    applyResolvedTheme(preference);
    themeListeners.forEach((listener) => listener());
  });
}

export function syncThemeRuntime(preference: ThemePreference): void {
  applyResolvedTheme(preference);
  ensureStorageWatcher();
}

export function setThemePreference(preference: ThemePreference): void {
  const stored = coerceThemePreference(preference);
  syncThemeRuntime(stored);
  persistThemePreference(stored);
  themeListeners.forEach((listener) => listener());
}

export function initTheme(): ThemePreference {
  const preference = readThemePreference();
  syncThemeRuntime(preference);
  persistThemePreference(preference);
  return preference;
}

export function subscribeTheme(listener: () => void): () => void {
  themeListeners.add(listener);
  return () => themeListeners.delete(listener);
}
