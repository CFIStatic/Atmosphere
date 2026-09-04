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

/**
 * PostgREST / Supabase often collapse RLS, a bad service-role key, or a
 * leftover SECURITY INVOKER trigger into the single word "Forbidden".
 * That is a write we should retry with the user JWT after repairing
 * side effects — never a message for the office UI.
 */
export function isPrivilegeError(message: string | null | undefined): boolean {
  const msg = (message ?? '').trim();
  if (!msg) return false;
  if (/^forbidden$/i.test(msg)) return true;
  if (/\b42501\b/.test(msg)) return true;
  if (/row-level security|permission denied|not_org_member/i.test(msg)) return true;
  if (/invalid api key/i.test(msg)) return true;
  if (/jwt (expired|malformed|invalid)/i.test(msg)) return true;
  return false;
}

export function isJobCreateBlockingError(message: string | null | undefined): boolean {
  return isMemoryLedgerError(message) || isCrmAuditError(message) || isPrivilegeError(message);
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
  if (isMemoryLedgerError(msg) || isCrmAuditError(msg)) {
    return new HttpError(500, 'Could not create the job. Try again.', 'job_failed');
  }
  return new HttpError(500, fallback, code);
}

/** Admin first when present, then the signed-in user — never the same client twice. */
export function clientsToTry(admin: unknown, user: unknown): unknown[] {
  if (admin && admin !== user) return [admin, user];
  return user ? [user] : admin ? [admin] : [];
}

/**
 * Insert/update through the service role when it works. If that client is
 * forbidden (restricted key, RLS-shaped trigger), repair leftover CRM
 * side effects and retry — including with the user JWT, the path Start a
 * job already uses via intake_create_job_file.
 */
export async function attemptIntakeWrite<T>(
  clients: unknown[],
  write: (client: any) => Promise<{ data: T | null; error: { message?: string } | null }>,
  fallback: string,
  code: string,
): Promise<T> {
  await repairJobCreateSideEffects();
  let lastError: { message?: string } | null = null;
  for (const client of clients) {
    const first = await write(client);
    if (!first.error && first.data != null) return first.data;
    lastError = first.error;
    if (isJobCreateBlockingError(first.error?.message)) {
      await repairJobCreateSideEffects();
      const retry = await write(client);
      if (!retry.error && retry.data != null) return retry.data;
      lastError = retry.error ?? first.error;
    }
  }
  throw intakeWriteError(lastError, fallback, code);
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
