/**
 * Which jobs belong to this Field Capture login.
 *
 * Today and My Jobs are not the whole org board. They are the jobs this
 * person owns or is assigned to — the work they can film.
 */

export interface AssignmentRow {
  jobId: string;
  role?: string | null;
}

export function mergeAssignedJobs(
  assignments: AssignmentRow[],
  ownedIds: Iterable<string>,
): { ids: Set<string>; roleById: Map<string, string> } {
  const roleById = new Map<string, string>();
  for (const id of ownedIds) {
    if (id) roleById.set(id, 'owner');
  }
  for (const row of assignments) {
    if (!row.jobId) continue;
    const role = (row.role ?? '').trim();
    roleById.set(row.jobId, role || 'crew');
  }
  return { ids: new Set(roleById.keys()), roleById };
}

export function restrictToAssigned<T extends { id: string }>(
  jobs: T[],
  assignedIds: Set<string>,
): T[] {
  if (!assignedIds.size) return [];
  return jobs.filter((job) => assignedIds.has(job.id));
}

export interface SearchableFieldJob {
  name?: string | null;
  address?: string | null;
  number?: string | null;
  status?: string | null;
  at?: string | null;
  filmedOn?: string | null;
  role?: string | null;
}

/** Match every token against name, address, number, status, date, or role. */
export function searchFieldJobs<T extends SearchableFieldJob>(jobs: T[], query: string): T[] {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return jobs;
  return jobs.filter((job) => {
    const hay = [job.name, job.address, job.number, job.status, job.at, job.filmedOn, job.role]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return tokens.every((token) => hay.includes(token));
  });
}

export function lastFilmedByJob(proofs: { jobId?: string; workDate?: string | null }[]): Map<string, string> {
  const last = new Map<string, string>();
  for (const row of proofs) {
    const id = row.jobId ?? '';
    const day = (row.workDate ?? '').trim();
    if (!id || !day) continue;
    const prev = last.get(id);
    if (!prev || day > prev) last.set(id, day);
  }
  return last;
}
