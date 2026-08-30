/**
 * Job Files ranks by last opened on this device. Opening a file stamps
 * the time; jobs never opened here fall back to their last recorded event.
 */

const STORAGE_KEY = 'atmosphere.jobFileOpenedAt';
const MAX_ENTRIES = 200;

export function readJobFileOpenedAt(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (id && typeof value === 'number' && Number.isFinite(value)) out[id] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function touchJobFile(jobId: string, at = Date.now()): void {
  const id = jobId.trim();
  if (!id || typeof window === 'undefined') return;
  const next = { ...readJobFileOpenedAt(), [id]: at };
  const ids = Object.keys(next);
  if (ids.length > MAX_ENTRIES) {
    ids.sort((a, b) => (next[a] ?? 0) - (next[b] ?? 0));
    for (const drop of ids.slice(0, ids.length - MAX_ENTRIES)) delete next[drop];
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private browsing or a full quota: skip persist.
  }
}

export function jobFileActivityMs(
  job: { jobId: string; lastEventAt: string | null; updatedAt: string; createdAt: string },
  opened: Record<string, number> = readJobFileOpenedAt(),
): number {
  const clicked = opened[job.jobId];
  if (typeof clicked === 'number') return clicked;
  for (const iso of [job.lastEventAt, job.updatedAt, job.createdAt]) {
    if (!iso) continue;
    const ms = Date.parse(iso);
    if (Number.isFinite(ms)) return ms;
  }
  return 0;
}

export function sortJobFilesByLastOpened<
  T extends { jobId: string; lastEventAt: string | null; updatedAt: string; createdAt: string },
>(jobs: T[], opened: Record<string, number> = readJobFileOpenedAt()): T[] {
  return [...jobs].sort((a, b) => {
    const delta = jobFileActivityMs(b, opened) - jobFileActivityMs(a, opened);
    if (delta !== 0) return delta;
    return a.jobId.localeCompare(b.jobId);
  });
}
