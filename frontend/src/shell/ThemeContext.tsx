import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  cycleThemePreference,
  readThemePreference,
  setThemePreference,
  subscribeTheme,
  type ThemePreference,
} from '../lib/theme';

/**
 * Light / dark theming.
 *
 * The live console stores appearance in preferences (see lib/preferences.ts)
 * and applies it through lib/theme.ts. This provider is a thin React wrapper
 * over the same store for any shell that still mounts it — one attribute on
 * <html>, no flash between routes.
 */

interface ThemeValue {
  preference: ThemePreference;
  /** @deprecated Use `preference` — kept for older callers that expect light|dark. */
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeValue | undefined>(undefined);

function getSnapshot(): ThemePreference {
  return readThemePreference();
}

function getServerSnapshot(): ThemePreference {
  return 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const preference = useSyncExternalStore(subscribeTheme, getSnapshot, getServerSnapshot);

  const setTheme = useCallback((next: ThemePreference) => {
    setThemePreference(next);
  }, []);

  const value = useMemo<ThemeValue>(
    () => ({
      preference,
      theme: preference,
      setTheme,
      toggle: () => setTheme(cycleThemePreference(preference)),
    }),
    [preference, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
