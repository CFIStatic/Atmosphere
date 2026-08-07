import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * Queue a post-login navigation that waits until AuthContext has the user set.
 * Navigating immediately after login() races ProtectedRoute — it still sees
 * user=null and bounces back to /login?next=….
 */
export function usePendingAuthRedirect() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const pendingRef = useRef<string | null>(null);

  const queueRedirect = useCallback((to: string) => {
    pendingRef.current = to;
  }, []);

  useEffect(() => {
    if (loading || !user || !pendingRef.current) return;
    const to = pendingRef.current;
    pendingRef.current = null;
    navigate(to, { replace: true });
  }, [loading, user, navigate]);

  return queueRedirect;
}
