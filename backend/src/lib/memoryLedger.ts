import { createAdminClient } from './supabase.js';
import { HttpError } from './errors.js';

/**
 * The office "Start a job" path writes `crm_jobs`. Two leftover database
 * side effects can abort that insert:
 *
 *   1. `memory_events.job_id` grew a stray FK, so the capture trigger fails.
 *   2. `crm_jobs_audit` still writes to `crm_audit_log` after that table
 *      was dropped with the old CRM product.
 *
 * Detect those errors, repair them when the service role can, and never show
 * Postgres constraint names in the office UI.
 */

export function isMemoryLedgerError(message: string | null | undefined): boolean {
  const msg = message ?? '';
  if (/memory_events_job_id_fkey/i.test(msg)) return true;
  return /memory_events/i.test(msg) && /foreign key constraint/i.test(msg);
}

export function isCrmAuditError(message: string | null | undefined): boolean {
  const msg = message ?? '';
  if (/crm_audit_log/i.test(msg)) return true;
  if (/crm_jobs_audit|crm_properties_audit/i.test(msg)) return true;
  return /private\.crm_audit/i.test(msg);
}

export function isJobCreateBlockingError(message: string | null | undefined): boolean {
  return isMemoryLedgerError(message) || isCrmAuditError(message);
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
  if (isJobCreateBlockingError(msg)) {
    return new HttpError(500, 'Could not create the job. Try again.', 'job_failed');
  }
  return new HttpError(500, fallback, code);
}

/** Drop a stray memory_events.job_id FK. No-ops when the RPC is not applied yet. */
export async function repairMemoryJobFk(): Promise<boolean> {
  return callRepairRpc('repair_memory_job_fk', '[memory]');
}

/** Drop leftover CRM audit triggers. No-ops when the RPC is not applied yet. */
export async function repairCrmAuditTriggers(): Promise<boolean> {
  return callRepairRpc('repair_crm_audit_triggers', '[audit]');
}

export async function repairJobCreateSideEffects(): Promise<void> {
  await Promise.all([repairMemoryJobFk(), repairCrmAuditTriggers()]);
}

async function callRepairRpc(name: string, logPrefix: string): Promise<boolean> {
  const admin = createAdminClient();
  if (!admin) return false;
  const { error } = await admin.rpc(name);
  if (!error) return true;
  const msg = error.message ?? '';
  if (/does not exist|PGRST202|schema cache/i.test(msg)) return false;
  // eslint-disable-next-line no-console
  console.warn(`${logPrefix} ${name}:`, msg);
  return false;
}
