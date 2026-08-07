import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import { loginHref } from '../lib/authRedirect';
import { SpinnerIcon } from './icons';

/** Guards routes that require an authenticated user. */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const returnPath = `${location.pathname}${location.search}${location.hash}`;

  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="grid min-h-screen place-items-center text-brand-600"
      >
        <SpinnerIcon className="animate-spin" width={28} height={28} />
        <span className="sr-only">Loading…</span>
      </div>
    );
  }

  if (!user) {
    // ?next= survives refresh and links from the marketing site; state.from is a fallback.
    return (
      <Navigate
        to={loginHref(returnPath)}
        replace
        state={{ from: returnPath }}
      />
    );
  }

  return <>{children}</>;
}
