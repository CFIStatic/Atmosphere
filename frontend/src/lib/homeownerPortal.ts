import { useEffect, useState } from 'react';
import { api } from './api';
import { useAuth } from '../context/AuthContext';
import { getBillingOnboardingShared } from './billingOnboardingShared';

/**
 * Is the signed-in person an invited homeowner? Someone with at least one
 * live job invite and no working contractor account: no org, or an org whose
 * billing was never finished (a homeowner who once clicked through sign-up).
 * Drives which shell items show. The API enforces the real access on every
 * request; this only decides what to draw.
 */
const cache = new Map<string, Promise<boolean>>();

export function loadIsHomeowner(
  userId: string,
  lookup: () => Promise<{ grants: unknown[] }> = () => api.progressShareGrants(),
): Promise<boolean> {
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

/** An org that never finished required billing is not a working contractor account. */
export function loadIsHomeownerWithOrg(
  userId: string,
  billing = () => getBillingOnboardingShared(api.getBillingOnboarding),
  lookup?: () => Promise<{ grants: unknown[] }>,
): Promise<boolean> {
  return Promise.resolve()
    .then(billing)
    .then((status) => (status.required && !status.complete ? loadIsHomeowner(`${userId}:org`, lookup) : false))
    .catch(() => false);
}

export function useHomeownerPortal(): HomeownerPortalState {
  const { user, membership, membershipLoading } = useAuth();
  const userId = user?.id ?? null;
  const hasOrg = Boolean(membership);
  const needsLookup = Boolean(userId) && !membershipLoading;
  const [state, setState] = useState<{ userId: string | null; homeowner: boolean } | null>(null);

  useEffect(() => {
    if (!needsLookup || !userId) return;
    let cancelled = false;
    void (hasOrg ? loadIsHomeownerWithOrg(userId) : loadIsHomeowner(userId)).then((homeowner) => {
      if (!cancelled) setState({ userId, homeowner });
    });
    return () => {
      cancelled = true;
    };
  }, [needsLookup, userId, hasOrg]);

  if (membershipLoading) return { loading: true, homeowner: false };
  if (!needsLookup) return { loading: false, homeowner: false };
  if (!state || state.userId !== userId) return { loading: true, homeowner: false };
  return { loading: false, homeowner: state.homeowner };
}
