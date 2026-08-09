/**
 * Appearance preference for the Atmosphere console (and sibling surfaces that
 * share the same origin).
 *
 * `data-theme` on <html> is always the *resolved* palette (`light` | `dark`) so
 * CSS tokens stay simple. The user's choice — including `system` — lives in
 * `data-theme-preference` and in localStorage under a single key so the
 * marketing site, FOUC bootstrap, and React preferences stay aligned.
 */

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

/** Canonical key — read by index.html FOUC, preferences, and the website. */
export const THEME_STORAGE_KEY = 'atmosphere.theme';

const PREFERENCES_STORAGE_KEY = 'atmosphere.preferences';
/** Pre-unification website key; still read for migration, written for light/dark. */
const LEGACY_WEB_THEME_KEY = 'atm-theme';

const CYCLE: ThemePreference[] = ['system', 'light', 'dark'];

const themeListeners = new Set<() => void>();
let mediaCleanup: (() => void) | null = null;
let storageListening = false;

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function systemResolvedTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'dark';
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'dark';
  }
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === 'system' ? systemResolvedTheme() : preference;
}

export function cycleThemePreference(current: ThemePreference): ThemePreference {
  const index = CYCLE.indexOf(current);
  return CYCLE[(index + 1) % CYCLE.length];
}

export function themeLabel(preference: ThemePreference): string {
  if (preference === 'system') return 'System';
  if (preference === 'light') return 'Light';
  return 'Dark';
}

/**
 * Read the stored preference, migrating older keys when needed.
 * Default is `system` so a fresh browser follows the device.
 */
export function readThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  try {
    const direct = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemePreference(direct)) return direct;

    const prefsRaw = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (prefsRaw) {
      const parsed = JSON.parse(prefsRaw) as { theme?: unknown };
      if (isThemePreference(parsed.theme)) return parsed.theme;
    }

    const legacy = window.localStorage.getItem(LEGACY_WEB_THEME_KEY);
    if (legacy === 'light' || legacy === 'dark') return legacy;
  } catch {
    /* private mode / corrupt JSON */
  }
  return 'system';
}

/** Paint the resolved palette onto <html> without touching storage. */
export function applyResolvedTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference);
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', resolved);
    document.documentElement.setAttribute('data-theme-preference', preference);
  }
  return resolved;
}

/**
 * Persist the preference to every storage location that historically held it,
 * so a toggle in the app is visible on the marketing site (same origin) and
 * survives older FOUC snippets that still read `atm-theme`.
 */
export function persistThemePreference(preference: ThemePreference): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);

    let prefs: Record<string, unknown> = {};
    try {
      const raw = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
      if (raw) prefs = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      prefs = {};
    }
    window.localStorage.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({ ...prefs, theme: preference }),
    );

    if (preference === 'system') {
      window.localStorage.removeItem(LEGACY_WEB_THEME_KEY);
    } else {
      window.localStorage.setItem(LEGACY_WEB_THEME_KEY, preference);
    }
  } catch {
    /* storage unavailable — in-memory apply still works for this session */
  }
}

function ensureSystemWatcher(preference: ThemePreference): void {
  if (typeof window === 'undefined') return;

  if (mediaCleanup) {
    mediaCleanup();
    mediaCleanup = null;
  }

  if (preference !== 'system') return;

  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    applyResolvedTheme('system');
    themeListeners.forEach((listener) => listener());
  };
  mql.addEventListener('change', onChange);
  mediaCleanup = () => mql.removeEventListener('change', onChange);
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
    ensureSystemWatcher(preference);
    themeListeners.forEach((listener) => listener());
  });
}

/** Apply the preference and keep OS / cross-tab watchers in sync (no storage write). */
export function syncThemeRuntime(preference: ThemePreference): void {
  applyResolvedTheme(preference);
  ensureSystemWatcher(preference);
  ensureStorageWatcher();
}

/** Apply + persist + watch OS / other tabs. */
export function setThemePreference(preference: ThemePreference): void {
  syncThemeRuntime(preference);
  persistThemePreference(preference);
  themeListeners.forEach((listener) => listener());
}

/** Boot path: resolve from storage before React paints. */
export function initTheme(): ThemePreference {
  const preference = readThemePreference();
  syncThemeRuntime(preference);
  return preference;
}

export function subscribeTheme(listener: () => void): () => void {
  themeListeners.add(listener);
  return () => themeListeners.delete(listener);
}
