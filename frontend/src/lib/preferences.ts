import { useSyncExternalStore } from 'react';
import {
  applyDocumentLocale,
  coerceLocale,
  DEFAULT_LOCALE,
  persistLocalePreference,
  type AppLocale,
} from './locale';
import {
  coerceThemePreference,
  initTheme,
  persistThemePreference,
  readThemePreference,
  subscribeTheme,
  syncThemeRuntime,
  type ThemePreference,
} from './theme';

/**
 * Device-local user preferences.
 *
 * These deliberately never reach the server: they describe how *this* browser
 * should behave, not who the user is, so syncing them would mean a phone in the
 * field inheriting the layout of an office desktop. Anything that belongs to the
 * account (name, role, password) goes through the API instead.
 */
export interface Preferences {
  /** Suppress entrance animations and transitions. */
  reduceMotion: boolean;
  /** Ask for confirmation before signing out. */
  confirmSignOut: boolean;
  /**
   * Appearance: light or dark. Applied as `data-theme` on <html>.
   */
  theme: ThemePreference;
  /**
   * UI language for Settings and shell chrome. Applied as `lang` + `dir` on <html>.
   */
  locale: AppLocale;
}

export const DEFAULT_PREFERENCES: Preferences = {
  reduceMotion: false,
  confirmSignOut: false,
  theme: 'dark',
  locale: DEFAULT_LOCALE,
};

const STORAGE_KEY = 'atmosphere.preferences';

let current: Preferences = DEFAULT_PREFERENCES;
const listeners = new Set<() => void>();

function normalize(parsed: Partial<Preferences>, opts?: { hadStoredBlob?: boolean }): Preferences {
  let theme: ThemePreference;
  if (parsed.theme != null) {
    theme = coerceThemePreference(parsed.theme);
  } else if (opts?.hadStoredBlob) {
    // Pre-theme-key installs defaulted to dark when theme was absent from the blob.
    const migrated = readThemePreference();
    const hasExplicitThemeKey =
      typeof window !== 'undefined' &&
      (window.localStorage.getItem('atmosphere.theme') != null ||
        window.localStorage.getItem('atm-theme') != null);
    theme = hasExplicitThemeKey ? migrated : 'dark';
  } else {
    theme = readThemePreference();
  }
  return {
    ...DEFAULT_PREFERENCES,
    ...parsed,
    theme,
    locale: coerceLocale(parsed.locale),
  };
}

function read(): Preferences {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        ...DEFAULT_PREFERENCES,
        theme: readThemePreference(),
        locale: coerceLocale(undefined),
      };
    }
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    // Merge over the defaults so a preference added in a later release does not
    // arrive as `undefined` for users with an older blob already stored.
    return normalize(parsed, { hadStoredBlob: true });
  } catch {
    return {
      ...DEFAULT_PREFERENCES,
      theme: readThemePreference(),
      locale: coerceLocale(undefined),
    };
  }
}

/**
 * `reduceMotion` is applied as a class on <html> rather than per component, so
 * a single CSS rule can neutralise every animation in the app at once.
 */
function applyDocumentPreferences(prefs: Preferences) {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('reduce-motion', prefs.reduceMotion);
  syncThemeRuntime(prefs.theme);
  applyDocumentLocale(prefs.locale);
}

/** Called once at startup, before React renders, to avoid a flash of animation. */
export function initPreferences(): void {
  // initTheme applies the stored light/dark choice and cross-tab sync; then we
  // load the full preferences blob (which may refine theme from the same keys).
  initTheme();
  current = read();
  applyDocumentPreferences(current);
  persistThemePreference(current.theme);
  persistLocalePreference(current.locale);
  // Keep React state aligned when another tab (or the marketing site) changes
  // atmosphere.theme — otherwise the header toggle can show a stale selection.
  subscribeTheme(() => {
    const nextTheme = readThemePreference();
    if (current.theme === nextTheme) return;
    current = { ...current, theme: nextTheme };
    listeners.forEach((listener) => listener());
  });
}

export function getPreferences(): Preferences {
  return current;
}

export function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
  if (current[key] === value) return;
  current = { ...current, [key]: value };
  applyDocumentPreferences(current);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Private-browsing or a full quota: the preference still applies for this
    // session, it just will not survive a reload.
  }
  if (key === 'theme') {
    persistThemePreference(value as ThemePreference);
  }
  if (key === 'locale') {
    persistLocalePreference(value as AppLocale);
  }
  listeners.forEach((listener) => listener());
}

/** Test helper: restore English + defaults so locale tests do not leak. */
export function resetPreferencesForTests(next: Partial<Preferences> = {}): void {
  current = {
    ...DEFAULT_PREFERENCES,
    theme: 'dark',
    locale: DEFAULT_LOCALE,
    ...next,
  };
  applyDocumentPreferences(current);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Subscribe a component to the whole preference set. */
export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribe, getPreferences, () => DEFAULT_PREFERENCES);
}
