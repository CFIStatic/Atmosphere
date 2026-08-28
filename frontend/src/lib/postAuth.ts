import type { Membership } from './api';
import { safeAuthRedirect } from './authRedirect';
import { PLATFORM_HOME } from './platforms';
import { getPlatform } from './usePlatform';

/** Where to land after a successful sign-in — onboarding first if no org yet. */
export function postAuthDestination(
  membership: Membership | null,
  fallback = PLATFORM_HOME[getPlatform()],
): string {
  if (membership) return fallback;
  const next = safeAuthRedirect(fallback);
  if (next && next !== '/onboarding' && !next.startsWith('/signup')) {
    return `/signup?step=2&next=${encodeURIComponent(next)}`;
  }
  return '/signup?step=2';
}
