/**
 * Postgres-backed processing lease.
 *
 * video_processing_jobs already survive a restart; the in-memory RetryQueue
 * does not. A mid-job crash left status=running until the next boot reclaim.
 * These helpers stamp lease_until so a live process can steal expired work
 * every few seconds — no extra broker.
 */

export const VERIFICATION_LEASE_MS = 90_000;
export const VERIFICATION_RECLAIM_INTERVAL_MS = 30_000;

export function leaseOwnerId(env: NodeJS.Dict<string> = process.env): string {
  return (
    env.RAILWAY_REPLICA_ID?.trim() ||
    env.HOSTNAME?.trim() ||
    `pid-${typeof process !== 'undefined' ? process.pid : '0'}`
  );
}

export function leaseUntilIso(nowMs = Date.now(), ttlMs = VERIFICATION_LEASE_MS): string {
  return new Date(nowMs + ttlMs).toISOString();
}

/** Rows whose lease is missing or already expired. */
export function expiredLeaseFilter(
  nowIso = new Date().toISOString(),
  column = 'lease_until',
): string {
  return `${column}.is.null,${column}.lt.${nowIso}`;
}

/** True when another replica still holds the row. */
export function leaseIsHeld(leaseUntil: string | null | undefined, nowMs = Date.now()): boolean {
  if (!leaseUntil) return false;
  const until = Date.parse(leaseUntil);
  return Number.isFinite(until) && until > nowMs;
}
