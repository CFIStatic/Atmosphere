import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * Queue a post-login navigation that waits until AuthContext has the user set.
 * Navigating immediately after login() races ProtectedRoute — it still sees
 * user=null and bounces back to /login?next=….
 *
 * When the user is already loaded (a Stripe return, a comped workspace that
 * finishes setup after signup) nothing would re-run the wait, so navigate now.
 */
export function usePendingAuthRedirect() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const pendingRef = useRef<string | null>(null);
  const readyRef = useRef(false);

  const queueRedirect = useCallback(
    (to: string) => {
      if (readyRef.current) {
        pendingRef.current = null;
        navigate(to, { replace: true });
        return;
      }
      pendingRef.current = to;
    },
    [navigate],
  );

  useEffect(() => {
    readyRef.current = !loading && Boolean(user);
    if (!readyRef.current || !pendingRef.current) return;
    const to = pendingRef.current;
    pendingRef.current = null;
    navigate(to, { replace: true });
  }, [loading, user, navigate]);

  return queueRedirect;
}
