import type { Profile } from './api';

/** Cache-bust token from `…/avatar.jpg?v=1710000000000`, or “now” for a data URL. */
export function avatarCacheVersion(url: string | null | undefined): number {
  if (!url) return 0;
  if (url.startsWith('data:image/')) return Number.MAX_SAFE_INTEGER;
  const match = /[?&]v=(\d+)/.exec(url);
  return match ? Number(match[1]) : 0;
}

export function profileUpdatedAtMs(profile: Profile | null | undefined): number {
  if (!profile?.updatedAt) return 0;
  const t = Date.parse(profile.updatedAt);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Keep a photo the user just saved in Settings when a slower GET /api/profile
 * (boot, org refresh) still has the previous row.
 */
export function preferFresherProfile(
  current: Profile | null,
  incoming: Profile | null,
): Profile | null {
  if (!incoming) return current;
  if (!current) return incoming;

  const currentTs = profileUpdatedAtMs(current);
  const incomingTs = profileUpdatedAtMs(incoming);
  if (currentTs > incomingTs) return current;
  if (incomingTs > currentTs) return incoming;

  if (avatarCacheVersion(current.avatarUrl) > avatarCacheVersion(incoming.avatarUrl)) {
    return { ...incoming, avatarUrl: current.avatarUrl };
  }
  return incoming;
}
