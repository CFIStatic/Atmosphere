import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { landingPath } from '../lib/access';
import { ThemeToggle } from './ThemeToggle';

export function RequireStaff({ children }: { children: ReactNode }) {
  const { user, access, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-paper-100 text-ink-500">
        Loading…
      </div>
    );
  }

  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  if (!access?.scope) {
    return (
      <div className="relative grid min-h-screen place-items-center bg-paper-100 px-6">
        <div className="absolute right-6 top-4">
          <ThemeToggle />
        </div>
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold">Staff access only</h1>
          <p className="mt-2 text-sm text-ink-500">
            This site reads company-wide accounts and analytics. Ask an Atmosphere administrator
            to grant analytics access for {user.email}.
          </p>
        </div>
      </div>
    );
  }

  if (location.pathname === '/') {
    return <Navigate to={landingPath(access.scope)} replace />;
  }

  return children;
}
