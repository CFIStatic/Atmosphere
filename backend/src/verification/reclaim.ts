/**
 * Reclaim verification work that is still pending in Postgres after the
 * in-memory RetryQueue was lost (process restart or mid-job crash).
 *
 * Boot runs this once. startVerificationLeaseSweep repeats it so a live
 * replica can steal rows whose lease_until has passed.
 */

import { unscopedAdminOrNull } from '../lib/scopedAdmin.js';
import { logger } from '../lib/logger.js';
import { getVerificationOrchestrator } from './factory.js';
import { VERIFICATION_RECLAIM_INTERVAL_MS } from './lease.js';

let timer: ReturnType<typeof setInterval> | null = null;

export async function reclaimPendingVerificationJobs(): Promise<number> {
  const admin = unscopedAdminOrNull();
  if (!admin) return 0;
  try {
    const n = await getVerificationOrchestrator().reclaimPending(admin);
    if (n > 0) logger.info('verification_reclaimed', { count: n });
    return n;
  } catch (err) {
    logger.warn('verification_reclaim_failed', {
      detail: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}

export function startVerificationLeaseSweep(): void {
  if (timer) return;
  void reclaimPendingVerificationJobs();
  timer = setInterval(() => {
    void reclaimPendingVerificationJobs();
  }, VERIFICATION_RECLAIM_INTERVAL_MS);
  timer.unref?.();
}

export function stopVerificationLeaseSweep(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
