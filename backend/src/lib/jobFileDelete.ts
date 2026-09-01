import { createAdminClient } from './supabase.js';
import { repairMemoryJobFk } from './memoryLedger.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Soft-delete of a job file updates `crm_jobs`. Leftover CRM product triggers
 * still call `private.crm_audit()` → `public.crm_audit_log`. That table was
 * dropped with the old CRM product, so the update fails with:
 *   relation "public.crm_audit_log" does not exist
 *
 * Prefer dropping those triggers (RPC / deploy SQL). Until that lands, hide
 * the file with a memory_events tombstone so Delete permanently still works.
 *
 * Production Keys has the service-role JWT but no DATABASE_URL / access token,
 * so deploy-time SQL apply skips. The tombstone must therefore work through
 * PostgREST: service-role insert, or the existing record_memory_event RPC.
 */

export const JOB_FILE_DELETED_EVENT = 'job.file_deleted';
/** Allowed by public.record_memory_event (auth|session|view|export|note). */
export const JOB_FILE_DELETED_RPC_EVENT = 'note.file_deleted';

export function isCrmAuditLogMissingError(message: string | null | undefined): boolean {
  const msg = message ?? '';
  return /crm_audit_log/i.test(msg) && /does not exist/i.test(msg);
}

export function isJobFileDeletedEvent(eventType: string | null | undefined): boolean {
  return eventType === JOB_FILE_DELETED_EVENT || eventType === JOB_FILE_DELETED_RPC_EVENT;
}

/** Drop leftover CRM audit triggers. No-ops when the RPC is not applied yet. */
export async function repairCrmAuditTriggers(): Promise<boolean> {
  const admin = createAdminClient();
  if (!admin) return false;
  const { error } = await admin.rpc('repair_crm_audit_triggers');
  if (!error) return true;
  const msg = error.message ?? '';
  if (/does not exist|PGRST202|schema cache/i.test(msg)) return false;
  console.warn('[job-file] repair_crm_audit_triggers:', msg);
  return false;
}

type Writer = {
  from: (table: string) => any;
  rpc?: (fn: string, args: Record<string, unknown>) => any;
};

function collectTombstoneIds(rows: Array<{ job_id?: string | null; entity_id?: string | null }>): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.job_id) ids.add(row.job_id);
    if (row.entity_id) ids.add(row.entity_id);
  }
  return ids;
}

export async function listTombstonedJobIds(
  writer: Writer,
  orgId: string,
): Promise<Set<string>> {
  const { data, error } = await writer
    .from('memory_events')
    .select('job_id, entity_id, event_type')
    .eq('org_id', orgId)
    .in('event_type', [JOB_FILE_DELETED_EVENT, JOB_FILE_DELETED_RPC_EVENT])
    .limit(5_000);
  if (error) {
    console.warn('[job-file] tombstone list failed:', error.message);
    return new Set();
  }
  return collectTombstoneIds((data ?? []) as Array<{ job_id?: string | null; entity_id?: string | null }>);
}

export async function jobFileIsTombstoned(
  writer: Writer,
  orgId: string,
  jobId: string,
): Promise<boolean> {
  const { data, error } = await writer
    .from('memory_events')
    .select('id')
    .eq('org_id', orgId)
    .in('event_type', [JOB_FILE_DELETED_EVENT, JOB_FILE_DELETED_RPC_EVENT])
    .or(`job_id.eq.${jobId},entity_id.eq.${jobId}`)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn('[job-file] tombstone check failed:', error.message);
    return false;
  }
  return Boolean(data);
}

async function insertTombstone(
  writer: Writer,
  input: { orgId: string; jobId: string; title: string; actorId: string | null },
  jobIdColumn: string | null,
): Promise<string | null> {
  const { error } = await writer.from('memory_events').insert({
    org_id: input.orgId,
    actor_id: input.actorId,
    event_type: JOB_FILE_DELETED_EVENT,
    entity_type: 'job',
    entity_id: input.jobId,
    job_id: jobIdColumn,
    summary: `Job file “${input.title}” deleted from the library.`,
    changes: { deleted_at: { from: null, to: 'tombstone' } },
    snapshot: { id: input.jobId, title: input.title, deleted: true },
    source: 'app',
  });
  return error?.message ?? null;
}

async function recordTombstoneViaRpc(
  writer: Writer,
  input: { jobId: string; title: string },
): Promise<string | null> {
  if (!writer.rpc) return 'record_memory_event is not available';
  const { error } = await writer.rpc('record_memory_event', {
    p_event_type: JOB_FILE_DELETED_RPC_EVENT,
    p_summary: `Job file “${input.title}” deleted from the library.`,
    p_entity_type: 'job',
    p_entity_id: input.jobId,
    // Leave job_id null so a stray memory_events.job_id FK cannot block delete.
    p_job_id: null,
    p_details: { id: input.jobId, title: input.title, deleted: true },
  });
  return error?.message ?? null;
}

export async function writeJobFileDeleteTombstone(
  writer: Writer,
  input: {
    orgId: string;
    jobId: string;
    title: string;
    actorId: string | null;
  },
  rpcWriter?: Writer,
): Promise<void> {
  await repairMemoryJobFk();

  let message = await insertTombstone(writer, input, input.jobId);
  if (!message) return;

  if (/memory_events_job_id_fkey|foreign key constraint/i.test(message)) {
    message = await insertTombstone(writer, input, null);
    if (!message) return;
  }

  for (const client of [rpcWriter, writer]) {
    if (!client) continue;
    const rpcMessage = await recordTombstoneViaRpc(client, input);
    if (!rpcMessage) return;
    message = message || rpcMessage;
  }

  throw new Error(message);
}

/**
 * Stamp deleted_at on crm_jobs. Retries after repairing leftover audit
 * triggers. Returns null when the row is gone; throws other errors.
 */
export async function softDeleteCrmJobRow(
  writer: Writer,
  input: {
    orgId: string;
    jobId: string;
    userId: string;
    now: string;
  },
): Promise<{ id: string; title: string } | null> {
  const attempt = () =>
    writer
      .from('crm_jobs')
      .update({ deleted_at: input.now, deleted_by: input.userId })
      .eq('org_id', input.orgId)
      .eq('id', input.jobId)
      .is('deleted_at', null)
      .select('id, title')
      .maybeSingle();

  let { data, error } = await attempt();
  if (!error) return (data as { id: string; title: string } | null) ?? null;

  if (!isCrmAuditLogMissingError(error.message)) {
    throw new Error(error.message);
  }

  await repairCrmAuditTriggers();
  ({ data, error } = await attempt());
  if (!error) return (data as { id: string; title: string } | null) ?? null;

  if (isCrmAuditLogMissingError(error.message)) {
    // Caller falls back to a tombstone so Delete permanently still succeeds.
    throw Object.assign(new Error(error.message), { code: 'crm_audit_log_missing' as const });
  }
  throw new Error(error.message);
}
