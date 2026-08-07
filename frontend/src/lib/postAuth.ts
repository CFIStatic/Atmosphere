import type { Membership } from './api';
import { PLATFORM_HOME } from './platforms';
import { getPlatform } from './usePlatform';

/** Where to land after a successful sign-in — onboarding first if no org yet. */
export function postAuthDestination(
  membership: Membership | null,
  fallback = PLATFORM_HOME[getPlatform()],
): string {
  return membership ? fallback : '/onboarding';
}
