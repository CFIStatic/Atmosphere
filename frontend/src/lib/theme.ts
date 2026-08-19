/**
 * Appearance preference for the Atmosphere console (and sibling surfaces that
 * share the same origin).
 *
 * Light and dark only. A leftover `system` value from older builds is resolved
 * once to the current OS palette and then stored as an explicit choice, so the
 * header control is a single click between moon and sun.
 */

export type ThemePreference = 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

/** Canonical key — read by index.html FOUC, preferences, and the website. */
export const THEME_STORAGE_KEY = 'atmosphere.theme';

const PREFERENCES_STORAGE_KEY = 'atmosphere.preferences';
/** Pre-unification website key; still read for migration, written for light/dark. */
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

/** Stored `system` (older builds) becomes the OS palette at that moment. */
export function coerceThemePreference(value: unknown): ThemePreference {
  if (isThemePreference(value)) return value;
  return systemResolvedTheme();
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference;
}

/** One click: light ↔ dark. */
export function cycleThemePreference(current: ThemePreference): ThemePreference {
  return current === 'dark' ? 'light' : 'dark';
}

export function themeLabel(preference: ThemePreference): string {
  return preference === 'light' ? 'Light' : 'Dark';
}

/**
 * Read the stored preference, migrating older keys when needed.
 * A first visit (or leftover `system`) becomes an explicit light or dark.
 */
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

/** Paint the palette onto <html> without touching storage. */
export function applyResolvedTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference);
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', resolved);
    document.documentElement.setAttribute('data-theme-preference', resolved);
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
    /* storage unavailable — in-memory apply still works for this session */
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

/** Apply the preference and keep cross-tab watchers in sync (no storage write). */
export function syncThemeRuntime(preference: ThemePreference): void {
  applyResolvedTheme(preference);
  ensureStorageWatcher();
}

/** Apply + persist + notify listeners. */
export function setThemePreference(preference: ThemePreference): void {
  const stored = coerceThemePreference(preference);
  syncThemeRuntime(stored);
  persistThemePreference(stored);
  themeListeners.forEach((listener) => listener());
}

/** Boot path: resolve from storage before React paints. */
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
