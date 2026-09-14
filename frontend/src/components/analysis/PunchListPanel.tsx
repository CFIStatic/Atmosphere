import { useMemo, useState } from 'react';
import { eventClock } from '../../lib/downloadJson';
import { api, type PunchListItem } from '../../lib/api';

const SOURCE_WORD: Record<PunchListItem['source'], string> = {
  action: 'Next step',
  commitment: 'Commitment',
  unresolved: 'Open question',
  scope_in_progress: 'In progress',
  concern: 'Concern',
};

/**
 * Open items from film analysis — assignable, seekable.
 * Hidden when analysis recorded nothing open (never invents).
 */
export function PunchListPanel({
  jobId,
  items,
  onSeek,
  onAssigned,
}: {
  jobId?: string | null;
  items: PunchListItem[];
  onSeek?: (item: PunchListItem) => void;
  onAssigned?: (item: PunchListItem, taskId: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localAssigned, setLocalAssigned] = useState<Record<string, string>>({});

  const list = useMemo(
    () =>
      items.map((item) => ({
        ...item,
        assignedTaskId: localAssigned[item.fingerprint] ?? item.assignedTaskId,
      })),
    [items, localAssigned],
  );

  const openCount = list.filter((i) => !i.assignedTaskId).length;
  if (!list.length) return null;

  async function assign(item: PunchListItem) {
    if (!jobId || item.assignedTaskId || busyId) return;
    setBusyId(item.id);
    setError(null);
    try {
      const res = await api.assignPunchListTask(jobId, item);
      setLocalAssigned((prev) => ({ ...prev, [item.fingerprint]: res.task.id }));
      onAssigned?.(item, res.task.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not assign that item.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="rounded-lg border border-line" data-testid="punch-list-panel">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
      >
        <span className="text-[13px] font-semibold text-ink-900">Punch list</span>
        <span className="text-[11px] font-medium text-ink-600">
          {openCount} open · {list.length} from film
        </span>
      </button>
      {open && (
        <div className="border-t border-line px-3 py-2.5" data-testid="punch-list">
          <p className="mb-2 text-[11px] leading-snug text-ink-500">
            Open items pulled from video analysis only — nothing invented. Tap a time to seek.
          </p>
          {error && <p className="mb-2 text-[12px] text-caution-700">{error}</p>}
          <ol className="space-y-2">
            {list.map((item) => (
              <li key={item.id} className="rounded-md px-1 py-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-500">
                    {SOURCE_WORD[item.source]}
                  </span>
                  {item.seekSeconds != null && (
                    <button
                      type="button"
                      data-testid={`punch-seek-${item.id}`}
                      onClick={() => onSeek?.(item)}
                      className="font-mono text-[11px] tabular-nums text-brand-700 hover:underline"
                    >
                      {eventClock(item.seekSeconds)}
                    </button>
                  )}
                  {item.workDate && (
                    <span className="text-[11px] text-ink-500">{item.workDate}</span>
                  )}
                  {item.ownerLabel && (
                    <span className="rounded-full bg-paper-200 px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide text-ink-500">
                      {item.ownerLabel}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[13px] font-medium text-ink-900">{item.text}</p>
                {item.detail && (
                  <p className="mt-0.5 text-[12px] leading-snug text-ink-600">{item.detail}</p>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {item.assignedTaskId ? (
                    <span className="text-[11px] font-medium text-ink-500">Assigned</span>
                  ) : jobId ? (
                    <button
                      type="button"
                      data-testid={`punch-assign-${item.id}`}
                      disabled={busyId === item.id}
                      onClick={() => void assign(item)}
                      className="rounded-md border border-line bg-paper-50 px-2 py-0.5 text-[11px] font-semibold text-ink-800 hover:bg-paper-100 disabled:opacity-60"
                    >
                      {busyId === item.id ? 'Assigning…' : 'Assign task'}
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
