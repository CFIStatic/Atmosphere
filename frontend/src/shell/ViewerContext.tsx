import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import type { Role } from '../domain/types';

/**
 * Who is looking at the product, and in what capacity.
 *
 * The real role comes from `org_members.role` via AuthContext. The override
 * exists because role-based views are otherwise impossible to review without
 * maintaining five test accounts — and because `executive` is not yet a
 * database role, so it can only be reached this way for now.
 *
 * The override is presentation-only. It never widens what the server will
 * actually authorise, which stays enforced by RLS and the BFF.
 */

interface ViewerValue {
  role: Role;
  /** The role actually stored on the membership, ignoring any override. */
  actualRole: Role;
  isOverridden: boolean;
  viewAs: (role: Role | null) => void;
  displayName: string;
}

const ViewerContext = createContext<ViewerValue | undefined>(undefined);

const STORAGE_KEY = 'atmosphere.viewAs';

function readStoredOverride(): Role | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (raw as Role) : null;
  } catch {
    return null;
  }
}

export function ViewerProvider({ children }: { children: ReactNode }) {
  const { user, membership } = useAuth();
  const [override, setOverride] = useState<Role | null>(readStoredOverride);

  const viewAs = useCallback((role: Role | null) => {
    setOverride(role);
    try {
      if (role) window.localStorage.setItem(STORAGE_KEY, role);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable (private mode) — the override just won't persist */
    }
  }, []);

  const actualRole: Role = (membership?.role as Role | undefined) ?? 'project_manager';

  const value = useMemo<ViewerValue>(
    () => ({
      role: override ?? actualRole,
      actualRole,
      isOverridden: override !== null && override !== actualRole,
      viewAs,
      displayName: user?.email?.split('@')[0] ?? 'there',
    }),
    [override, actualRole, viewAs, user?.email],
  );

  return <ViewerContext.Provider value={value}>{children}</ViewerContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useViewer(): ViewerValue {
  const ctx = useContext(ViewerContext);
  if (!ctx) throw new Error('useViewer must be used within a ViewerProvider');
  return ctx;
}
