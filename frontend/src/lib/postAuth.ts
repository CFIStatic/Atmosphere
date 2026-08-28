import type { Membership } from './api';
import { safeAuthRedirect } from './authRedirect';
import { PLATFORM_HOME, WORKER_HOME } from './platforms';
import { getPlatform } from './usePlatform';

const DEFAULT_OFFICE_HOMES = new Set([
  PLATFORM_HOME.operations,
  PLATFORM_HOME.field,
  '/dashboard',
  '/overview',
  '/',
]);

/** Office library vs worker phone — only when nobody asked for a specific page. */
export function isDefaultOfficeHome(path: string): boolean {
  return DEFAULT_OFFICE_HOMES.has(path);
}

export function homeForMembership(
  membership: Membership | null,
  fallback = PLATFORM_HOME[getPlatform()],
): string {
  if (membership?.role === 'field_technician' && isDefaultOfficeHome(fallback)) {
    return WORKER_HOME;
  }
  return fallback;
}

/** Where to land after a successful sign-in — onboarding first if no org yet. */
export function postAuthDestination(
  membership: Membership | null,
  fallback = PLATFORM_HOME[getPlatform()],
): string {
  if (membership) return homeForMembership(membership, fallback);
  const next = safeAuthRedirect(fallback);
  if (next && next !== '/onboarding' && !next.startsWith('/signup')) {
    return `/signup?step=2&next=${encodeURIComponent(next)}`;
  }
  return '/signup?step=2';
}
