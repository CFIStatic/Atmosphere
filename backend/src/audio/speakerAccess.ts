/**
 * Speaker reads and writes take job and clip ids from the URL. Row level
 * security on speaker_identities only checks that the caller belongs to the
 * row's company, so a member can point their own org at another company's
 * job or clip. These lookups reject that before any read or write.
 */

import { HttpError, notFound } from '../lib/errors.js';

type Row = Record<string, unknown>;

/** The user-scoped client. Admin is never used here: it can see every company. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UserDb = { from: (table: string) => any };

function sameId(value: unknown, expected: string): boolean {
  return String(value ?? '') === expected;
}

/** The job must belong to the caller's company. A miss is 404, not an empty list. */
export async function requireCompanyJob(supabase: UserDb, orgId: string, jobId: string): Promise<void> {
  const { data, error } = await supabase
    .from('crm_jobs')
    .select('id, org_id')
    .eq('id', jobId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message, 'job_load_failed');
  if (!data || !sameId((data as Row).id, jobId) || !sameId((data as Row).org_id, orgId)) {
    throw notFound('Job not found.', 'job_missing');
  }
}

/** The clip must belong to the caller's company and to this job. */
export async function requireCompanyClip(
  supabase: UserDb,
  orgId: string,
  jobId: string,
  proofId: string,
): Promise<void> {
  await requireCompanyJob(supabase, orgId, jobId);
  const { data, error } = await supabase
    .from('job_proofs')
    .select('id, org_id, job_id')
    .eq('id', proofId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message, 'clip_load_failed');
  const row = data as Row | null;
  if (!row || !sameId(row.id, proofId) || !sameId(row.org_id, orgId) || !sameId(row.job_id, jobId)) {
    throw notFound('Clip not found.', 'clip_missing');
  }
}

/** Every clip a speaker write will touch must sit on this job in this company. */
export async function requireCompanyClips(
  supabase: UserDb,
  orgId: string,
  jobId: string,
  proofIds: string[],
): Promise<void> {
  await requireCompanyJob(supabase, orgId, jobId);
  const ids = [...new Set(proofIds.filter(Boolean))];
  if (!ids.length) return;
  const { data, error } = await supabase
    .from('job_proofs')
    .select('id, org_id, job_id')
    .eq('org_id', orgId)
    .in('id', ids);
  if (error) throw new HttpError(500, error.message, 'clip_load_failed');
  const rows = (data ?? []) as Row[];
  for (const proofId of ids) {
    const row = rows.find((item) => sameId(item.id, proofId));
    if (!row || !sameId(row.org_id, orgId) || !sameId(row.job_id, jobId)) {
      throw notFound('Clip not found.', 'clip_missing');
    }
  }
}
