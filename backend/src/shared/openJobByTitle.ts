/**
 * Same org + normalized title → reuse the existing open crm_jobs row.
 * Stops Field Capture / Platform from minting a second folder (Tiffany & Co.).
 */

export const OPEN_JOB_STATUSES = [
  'draft',
  'pending',
  'sent',
  'scheduled',
  'in_progress',
  'on_hold',
] as const;

const OPEN = new Set<string>(OPEN_JOB_STATUSES);

export type OpenJobTitleRow = {
  id: string;
  title: string;
  job_number: number | null;
  status: string;
  created_at?: string | null;
};

/** Trim, collapse whitespace, lowercase — matches Field Capture normalizeJobTitle. */
export function normalizeJobTitleKey(title: string | null | undefined): string {
  return String(title || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function isOpenJobStatus(status: string | null | undefined): boolean {
  return OPEN.has(String(status || ''));
}

/**
 * Prefer the newest open row whose normalized title matches.
 * Callers should already exclude soft-deleted rows.
 */
export function pickOpenJobByNormalizedTitle(
  rows: OpenJobTitleRow[],
  title: string,
): OpenJobTitleRow | null {
  const want = normalizeJobTitleKey(title);
  if (!want) return null;
  const matches = rows.filter(
    (row) =>
      row?.id &&
      isOpenJobStatus(row.status) &&
      normalizeJobTitleKey(row.title) === want,
  );
  if (!matches.length) return null;
  return matches.sort((a, b) => {
    const aAt = a.created_at ? Date.parse(a.created_at) : 0;
    const bAt = b.created_at ? Date.parse(b.created_at) : 0;
    return bAt - aAt;
  })[0]!;
}

/**
 * Look up an open, non-deleted crm_jobs row in this org with the same
 * normalized title. Returns null when none — caller may create.
 */
export async function findOpenCrmJobByTitle(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  orgId: string,
  title: string,
): Promise<OpenJobTitleRow | null> {
  const want = normalizeJobTitleKey(title);
  if (!want) return null;
  // Strip % so PostgREST ilike cannot turn a title into a wildcard pattern.
  const safeIlike = title.trim().replace(/%/g, '').replace(/\s+/g, ' ');
  if (!safeIlike) return null;

  const { data, error } = await supabase
    .from('crm_jobs')
    .select('id, title, job_number, status, created_at')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .in('status', [...OPEN_JOB_STATUSES])
    .ilike('title', safeIlike)
    .order('created_at', { ascending: false })
    .limit(16);

  if (error) {
    console.warn('[open-job-by-title] lookup failed:', error.message ?? error);
    return null;
  }
  return pickOpenJobByNormalizedTitle((data ?? []) as OpenJobTitleRow[], title);
}
