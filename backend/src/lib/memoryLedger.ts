import { createAdminClient } from './supabase.js';
import { HttpError } from './errors.js';

/**
 * The office "Start a job" path writes `crm_jobs`, and a database trigger
 * records that in `memory_events`. A stray FK on `memory_events.job_id`
 * turns that ledger write into a failed job create. Detect that class of
 * error, repair it when the service role can, and never show Postgres
 * constraint names in the office UI.
 */

export function isMemoryLedgerError(message: string | null | undefined): boolean {
  const msg = message ?? '';
  if (/memory_events_job_id_fkey/i.test(msg)) return true;
  return /memory_events/i.test(msg) && /foreign key constraint/i.test(msg);
}

export function intakeWriteError(
  error: { message?: string } | null | undefined,
  fallback: string,
  code: string,
): HttpError {
  const msg = error?.message ?? '';
  if (msg) {
    // eslint-disable-next-line no-console
    console.warn(`[intake] ${code}:`, msg);
  }
  if (isMemoryLedgerError(msg)) {
    return new HttpError(500, 'Could not create the job. Try again.', 'job_failed');
  }
  return new HttpError(500, fallback, code);
}

/** Drop a stray memory_events.job_id FK. No-ops when the RPC is not applied yet. */
export async function repairMemoryJobFk(): Promise<boolean> {
  const admin = createAdminClient();
  if (!admin) return false;
  const { error } = await admin.rpc('repair_memory_job_fk');
  if (!error) return true;
  const msg = error.message ?? '';
  if (/does not exist|PGRST202|schema cache/i.test(msg)) return false;
  // eslint-disable-next-line no-console
  console.warn('[memory] repair_memory_job_fk:', msg);
  return false;
}
