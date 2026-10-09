/**
 * Edited questions. Questions and answers are append-only, so an edit is a new
 * row with supersedes_id pointing at the question it replaces. Like editing a
 * message in any chat app, the edit replaces that question and everything
 * asked after it: those rows stay on the record, but neither the person nor
 * the model sees them in the conversation any more.
 */

export interface EditableAskRow {
  id: string;
  created_at: string;
  supersedes_id?: string | null;
}

/**
 * The rows still in the conversation. `pending` is an edit being asked right
 * now (not stored yet): it hides the question it replaces and everything after.
 */
export function visibleAfterEdits<T extends EditableAskRow>(
  rows: readonly T[],
  pending?: { supersedesId: string; supersededAt: string | null } | null,
): T[] {
  const sorted = [...rows].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const at = new Map(sorted.map((r) => [r.id, String(r.created_at)]));
  // Each edit hides [the replaced question's time, the edit's time).
  const ranges: Array<[string, string]> = [];
  for (const row of sorted) {
    if (!row.supersedes_id) continue;
    // The replaced question is older than this window: everything before the edit goes.
    ranges.push([at.get(row.supersedes_id) ?? '', String(row.created_at)]);
  }
  if (pending) ranges.push([pending.supersededAt ?? at.get(pending.supersedesId) ?? '', '￿']);
  return sorted.filter((row) => {
    const t = String(row.created_at);
    return !ranges.some(([from, to]) => t >= from && t < to);
  });
}
