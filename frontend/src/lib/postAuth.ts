import type { Membership } from './api';
import { safeAuthRedirect } from './authRedirect';
import { isFieldEmbedMarked, withFieldEmbed } from './fieldEmbed';
import { PLATFORM_HOME } from './platforms';
import { getPlatform } from './usePlatform';

/** Where to land after a successful sign-in — onboarding first if no org yet. */
export function postAuthDestination(
  membership: Membership | null,
  fallback = PLATFORM_HOME[getPlatform()],
): string {
  const dest = membership
    ? fallback
    : (() => {
        const next = safeAuthRedirect(fallback);
        if (next && next !== '/onboarding' && !next.startsWith('/signup')) {
          return `/signup?step=2&next=${encodeURIComponent(next)}`;
        }
        return '/signup?step=2';
      })();
  return isFieldEmbedMarked() ? withFieldEmbed(dest) : dest;
}
