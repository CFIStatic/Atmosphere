import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import { SpinnerIcon } from './icons';

/** Guards routes that require an authenticated user. */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center text-brand-300">
        <SpinnerIcon className="animate-spin" width={28} height={28} />
      </div>
    );
  }

  if (!user) {
    // Remember where they were headed so we can send them back after login.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
