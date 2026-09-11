import { api, type Membership } from './api';
import { safeAuthRedirect } from './authRedirect';
import { isFieldEmbedMarked, withFieldEmbed } from './fieldEmbed';
import { HOMEOWNER_HUB_PATH, isHomeownerViewerPath } from './homeownerHub';
import { PLATFORM_HOME } from './platforms';
import { getPlatform } from './usePlatform';

/** Where to land after a successful sign-in — onboarding first if no org yet. */
export function postAuthDestination(
  membership: Membership | null,
  fallback = PLATFORM_HOME[getPlatform()],
): string {
  if (isFieldEmbedMarked()) {
    const next = safeAuthRedirect(fallback) ?? '/verifier-library';
    if (next.startsWith('/signup') || next === '/onboarding') {
      return withFieldEmbed('/verifier-library');
    }
    return withFieldEmbed(next);
  }
  const dest = membership
    ? fallback
    : (() => {
        const next = safeAuthRedirect(fallback);
        if (next && isHomeownerViewerPath(next)) return next;
        if (next && next !== '/onboarding' && !next.startsWith('/signup')) {
          return `/signup?next=${encodeURIComponent(next)}`;
        }
        return '/signup';
      })();
  return dest;
}

/**
 * Grant-only / homeowner accounts are not org_members. Prefer the hub (or a
 * job deep link) instead of office Overview / workspace setup.
 */
export async function resolveNoOrgDestination(
  fallback: string,
  options?: {
    intent?: string | null;
    lookupGrants?: () => Promise<{ grants: unknown[] }>;
  },
): Promise<string> {
  if (isFieldEmbedMarked()) return postAuthDestination(null, fallback);
  const next = safeAuthRedirect(fallback);
  if (next && isHomeownerViewerPath(next)) return next;
  if (options?.intent === 'homeowner') return HOMEOWNER_HUB_PATH;
  try {
    const lookup = options?.lookupGrants ?? (() => api.progressShareGrants());
    const { grants } = await lookup();
    if (grants.length) return HOMEOWNER_HUB_PATH;
  } catch {
    /* Grants lookup failed — finish workspace setup. */
  }
  return postAuthDestination(null, fallback);
}
