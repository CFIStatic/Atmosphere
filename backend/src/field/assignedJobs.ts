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
