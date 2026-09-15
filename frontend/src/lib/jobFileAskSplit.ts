/**
 * Preferred Ask-column width on the desktop job-file split (Ask | evidence).
 * Device-local; one value for all jobs is fine.
 */

export const JOB_FILE_ASK_SPLIT_KEY = 'atmosphere.jobFileAskWidth';

/** Matches the previous fixed `lg:w-[min(32rem,42%)]` — 32rem at default root. */
export const DEFAULT_ASK_WIDTH_PX = 512;

export const MIN_ASK_WIDTH_PX = 280;
export const MIN_FILE_WIDTH_PX = 360;

export function clampAskWidth(width: number, containerWidth?: number): number {
  const n = Number.isFinite(width) ? width : DEFAULT_ASK_WIDTH_PX;
  let max = Number.POSITIVE_INFINITY;
  if (containerWidth != null && Number.isFinite(containerWidth) && containerWidth > 0) {
    max = Math.max(MIN_ASK_WIDTH_PX, containerWidth - MIN_FILE_WIDTH_PX);
  }
  return Math.min(max, Math.max(MIN_ASK_WIDTH_PX, Math.round(n)));
}

export function readAskSplitWidth(): number {
  try {
    if (typeof window === 'undefined') return DEFAULT_ASK_WIDTH_PX;
    const raw = window.localStorage.getItem(JOB_FILE_ASK_SPLIT_KEY);
    if (raw == null || raw === '') return DEFAULT_ASK_WIDTH_PX;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return DEFAULT_ASK_WIDTH_PX;
    return clampAskWidth(parsed);
  } catch {
    return DEFAULT_ASK_WIDTH_PX;
  }
}

export function writeAskSplitWidth(width: number): number {
  const next = clampAskWidth(width);
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(JOB_FILE_ASK_SPLIT_KEY, String(next));
    }
  } catch {
    /* private mode / quota — preference is best-effort */
  }
  return next;
}

export function clearAskSplitWidth(): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(JOB_FILE_ASK_SPLIT_KEY);
    }
  } catch {
    /* ignore */
  }
}
