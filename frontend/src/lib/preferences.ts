import { useSyncExternalStore } from 'react';

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
  /** Start the sidebar in its icon-only form on wide screens. */
  collapsedSidebar: boolean;
  /** Ask for confirmation before signing out. */
  confirmSignOut: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  reduceMotion: false,
  collapsedSidebar: false,
  confirmSignOut: false,
};

const STORAGE_KEY = 'atmosphere.preferences';

let current: Preferences = DEFAULT_PREFERENCES;
const listeners = new Set<() => void>();

function read(): Preferences {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    // Merge over the defaults so a preference added in a later release does not
    // arrive as `undefined` for users with an older blob already stored.
    return { ...DEFAULT_PREFERENCES, ...parsed };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

/**
 * `reduceMotion` is applied as a class on <html> rather than per component, so
 * a single CSS rule can neutralise every animation in the app at once.
 */
function applyDocumentPreferences(prefs: Preferences) {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('reduce-motion', prefs.reduceMotion);
}

/** Called once at startup, before React renders, to avoid a flash of animation. */
export function initPreferences(): void {
  current = read();
  applyDocumentPreferences(current);
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
  listeners.forEach((listener) => listener());
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
