import { HttpError } from './errors.js';
import { ensureCrmAuditLog, isCrmAuditLogMissingError, repairCrmAuditTriggers } from './jobFileDelete.js';
import { isJobCreateBlockingError, repairMemoryJobFk } from './memoryLedger.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const RENAME_FAILED = 'Could not rename that job file. Try again.';

type Writer = {
  from: (table: string) => any;
};

export type RenamedJobFile = {
  id: string;
  job_number: number | null;
  title: string;
  status: string | null;
  claim_number: string | null;
};

/**
 * PostgREST / leftover CRM triggers often surface as "Forbidden" or a
 * permission-denied string. The office should never see those words.
 */
export function isOpaqueJobWriteError(message: string | null | undefined): boolean {
  const msg = (message ?? '').trim();
  if (!msg) return true;
  if (isJobCreateBlockingError(msg) || isCrmAuditLogMissingError(msg)) return true;
  return /^(forbidden|unauthorized|access denied|not allowed)$/i.test(msg)
    || /permission denied/i.test(msg)
    || /row-level security/i.test(msg)
    || /42501/.test(msg);
}

export function renameJobFileError(error: { message?: string } | null | undefined): HttpError {
  const msg = error?.message ?? '';
  if (msg) {
    // eslint-disable-next-line no-console
    console.warn('[job-file] rename_failed:', msg);
  }
  if (isOpaqueJobWriteError(msg)) {
    return new HttpError(400, RENAME_FAILED, 'rename_failed');
  }
  return new HttpError(400, msg || RENAME_FAILED, 'rename_failed');
}

async function updateJobTitle(
  writer: Writer,
  input: { orgId: string; jobId: string; title: string },
): Promise<{ data: RenamedJobFile | null; error: { message?: string } | null }> {
  return writer
    .from('crm_jobs')
    .update({ title: input.title })
    .eq('org_id', input.orgId)
    .eq('id', input.jobId)
    .is('deleted_at', null)
    .select('id, job_number, title, status, claim_number')
    .maybeSingle();
}

/**
 * Change the painted job-file name. Uses the service-role writer when the
 * caller has one — the same posture as delete / duplicate — so leftover CRM
 * audit triggers and RLS grants cannot turn a rename into a raw 403.
 */
export async function renameCrmJobTitle(
  writer: Writer,
  input: { orgId: string; jobId: string; title: string },
): Promise<RenamedJobFile> {
  await repairMemoryJobFk();
  await ensureCrmAuditLog();
  await repairCrmAuditTriggers();

  let { data, error } = await updateJobTitle(writer, input);
  if (error && isJobCreateBlockingError(error.message)) {
    await ensureCrmAuditLog();
    await repairCrmAuditTriggers();
    ({ data, error } = await updateJobTitle(writer, input));
  }

  if (error) throw renameJobFileError(error);
  if (!data) throw new HttpError(404, 'No such job.', 'job_not_found');
  return data;
}
