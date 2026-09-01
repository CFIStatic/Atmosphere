import { createAdminClient } from './supabase.js';

/**
 * Soft-delete of a job file updates `crm_jobs`. Leftover CRM product triggers
 * still call `private.crm_audit()` → `public.crm_audit_log`. That table was
 * dropped with the old CRM product, so the update fails with:
 *   relation "public.crm_audit_log" does not exist
 *
 * Prefer dropping those triggers (RPC / deploy SQL). Until that lands, hide
 * the file with a memory_events tombstone so Delete permanently still works.
 */

export const JOB_FILE_DELETED_EVENT = 'job.file_deleted';

export function isCrmAuditLogMissingError(message: string | null | undefined): boolean {
  const msg = message ?? '';
  return /crm_audit_log/i.test(msg) && /does not exist/i.test(msg);
}

/** Drop leftover CRM audit triggers. No-ops when the RPC is not applied yet. */
export async function repairCrmAuditTriggers(): Promise<boolean> {
  const admin = createAdminClient();
  if (!admin) return false;
  const { error } = await admin.rpc('repair_crm_audit_triggers');
  if (!error) return true;
  const msg = error.message ?? '';
  if (/does not exist|PGRST202|schema cache/i.test(msg)) return false;
  // eslint-disable-next-line no-console
  console.warn('[job-file] repair_crm_audit_triggers:', msg);
  return false;
}

type Writer = {
  from: (table: string) => any;
};

export async function listTombstonedJobIds(
  writer: Writer,
  orgId: string,
): Promise<Set<string>> {
  const { data, error } = await writer
    .from('memory_events')
    .select('job_id')
    .eq('org_id', orgId)
    .eq('event_type', JOB_FILE_DELETED_EVENT)
    .not('job_id', 'is', null)
    .limit(5_000);
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[job-file] tombstone list failed:', error.message);
    return new Set();
  }
  const ids = new Set<string>();
  for (const row of (data ?? []) as Array<{ job_id?: string | null }>) {
    if (row.job_id) ids.add(row.job_id);
  }
  return ids;
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
    .eq('job_id', jobId)
    .eq('event_type', JOB_FILE_DELETED_EVENT)
    .limit(1)
    .maybeSingle();
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[job-file] tombstone check failed:', error.message);
    return false;
  }
  return Boolean(data);
}

export async function writeJobFileDeleteTombstone(
  writer: Writer,
  input: {
    orgId: string;
    jobId: string;
    title: string;
    actorId: string | null;
  },
): Promise<void> {
  const { error } = await writer.from('memory_events').insert({
    org_id: input.orgId,
    actor_id: input.actorId,
    event_type: JOB_FILE_DELETED_EVENT,
    entity_type: 'job',
    entity_id: input.jobId,
    job_id: input.jobId,
    summary: `Job file “${input.title}” deleted from the library.`,
    changes: { deleted_at: { from: null, to: 'tombstone' } },
    snapshot: { id: input.jobId, title: input.title, deleted: true },
    source: 'app',
  });
  if (error) throw new Error(error.message);
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
