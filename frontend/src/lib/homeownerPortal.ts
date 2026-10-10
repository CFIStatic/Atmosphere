import { useEffect, useState } from 'react';
import { api } from './api';
import { useAuth } from '../context/AuthContext';

/**
 * Is the signed-in person an invited homeowner (no org, at least one live
 * job invite)? Drives which shell items show. The API enforces the real
 * access on every request; this only decides what to draw.
 */
const cache = new Map<string, Promise<boolean>>();

export function loadIsHomeowner(userId: string, lookup = () => api.progressShareGrants()): Promise<boolean> {
  let hit = cache.get(userId);
  if (!hit) {
    hit = lookup()
      .then((res) => res.grants.length > 0)
      .catch(() => {
        cache.delete(userId);
        return false;
      });
    cache.set(userId, hit);
  }
  return hit;
}

export function forgetHomeownerCache(): void {
  cache.clear();
}

export type HomeownerPortalState = { loading: boolean; homeowner: boolean };

export function useHomeownerPortal(): HomeownerPortalState {
  const { user, membership, membershipLoading } = useAuth();
  const userId = user?.id ?? null;
  const needsLookup = Boolean(userId) && !membershipLoading && !membership;
  const [state, setState] = useState<{ userId: string | null; homeowner: boolean } | null>(null);

  useEffect(() => {
    if (!needsLookup || !userId) return;
    let cancelled = false;
    void loadIsHomeowner(userId).then((homeowner) => {
      if (!cancelled) setState({ userId, homeowner });
    });
    return () => {
      cancelled = true;
    };
  }, [needsLookup, userId]);

  if (membershipLoading) return { loading: true, homeowner: false };
  if (!needsLookup) return { loading: false, homeowner: false };
  if (!state || state.userId !== userId) return { loading: true, homeowner: false };
  return { loading: false, homeowner: state.homeowner };
}
