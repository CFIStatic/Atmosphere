import { createHash } from 'node:crypto';
import type { User } from '@supabase/supabase-js';

/**
 * Short-lived memory of access tokens Supabase Auth has already verified.
 *
 * Every signed-in API call used to ask Supabase Auth `getUser` before doing
 * anything else: one network round trip per request, and a page opens a
 * dozen requests at once. A token Auth accepted a few seconds ago is
 * accepted again here for up to AUTH_CACHE_TTL_MS, never past the token's
 * own expiry. Concurrent requests carrying the same token share one lookup.
 *
 * Only successful lookups are kept. Sign-out, password changes, account
 * deletion and removal from an org call forgetCachedUser so this server
 * stops accepting that person's tokens at once; anything else Auth revokes
 * stops working within the TTL. Org membership and roles are never cached
 * here — requireOrgContext still reads them on every request.
 */

export const AUTH_CACHE_TTL_MS = 30_000;
const MAX_ENTRIES = 5_000;

type Lookup = { data: { user: User | null }; error: unknown };

const verified = new Map<string, { user: User; until: number }>();
const inflight = new Map<string, Promise<any>>();
/** Bumped by every forget, so a lookup already in flight is not cached after it. */
let generation = 0;

function keyOf(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The JWT's `exp` in ms, or null when it cannot be read. Not a signature check. */
export function tokenExpiryMs(token: string): number | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const exp = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))?.exp;
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

function remember(key: string, token: string, user: User, now: number): void {
  const exp = tokenExpiryMs(token);
  const until = Math.min(now + AUTH_CACHE_TTL_MS, exp ?? now + AUTH_CACHE_TTL_MS);
  if (until <= now) return;
  if (verified.size >= MAX_ENTRIES) {
    for (const [k, v] of verified) if (v.until <= now) verified.delete(k);
    if (verified.size >= MAX_ENTRIES) verified.clear();
  }
  verified.set(key, { user, until });
}

/**
 * `getUser(token)` through the cache. `lookup` is the real Supabase call;
 * its result is returned unchanged, so callers keep their error handling.
 */
export async function cachedGetUser<T extends Lookup>(
  token: string,
  lookup: (token: string) => Promise<T>,
  now: () => number = Date.now,
): Promise<T> {
  const key = keyOf(token);
  const hit = verified.get(key);
  if (hit) {
    if (hit.until > now()) return { data: { user: hit.user }, error: null } as T;
    verified.delete(key);
  }
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const started = generation;
  const run = lookup(token)
    .then((result) => {
      // A forget that landed while Auth was answering wins over the answer.
      if (!result.error && result.data?.user && started === generation) {
        remember(key, token, result.data.user, now());
      }
      return result;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, run);
  return run;
}

/** Stop accepting any cached token for this user (sign-out, revoke, delete). */
export function forgetCachedUser(userId: string | null | undefined): void {
  if (!userId) return;
  generation += 1;
  for (const [key, entry] of verified) {
    if (entry.user.id === userId) verified.delete(key);
  }
}

/** Drop one token, e.g. the session being signed out. */
export function forgetCachedToken(token: string | null | undefined): void {
  if (!token) return;
  generation += 1;
  verified.delete(keyOf(token));
}

/** Tests only. */
export function clearAuthUserCache(): void {
  verified.clear();
  inflight.clear();
}
