/**
 * After a process restart, video_processing_jobs rows are still pending in
 * Postgres but the in-memory RetryQueue is empty. Reclaim them once at boot.
 * The proof-analysis sweep already does the same for narration / transcript.
 */

import { createAdminClient } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import { getVerificationOrchestrator } from './factory.js';

export async function reclaimPendingVerificationJobs(): Promise<number> {
  const admin = createAdminClient();
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
