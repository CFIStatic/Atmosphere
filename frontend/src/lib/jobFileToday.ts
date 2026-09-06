import type { JobScopeItem, ProofQuestion, ProofResponse, ProofVideoRecord } from './api';

export interface JobFileTodayChange {
  clips: ProofVideoRecord[];
  scope: JobScopeItem[];
  unansweredAsk: ProofQuestion[];
}

export function localDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isoOnLocalDay(value: string | null | undefined, day: string): boolean {
  if (!value) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10) === day;
  return localDayKey(parsed) === day;
}

function clipLandedToday(video: ProofVideoRecord, day: string): boolean {
  if (video.receivedAt && isoOnLocalDay(video.receivedAt, day)) return true;
  return video.workDate === day;
}

function unansweredAsk(question: ProofQuestion): boolean {
  return !String(question.answer ?? '').trim();
}

/**
 * New clips, new scope lines, and unanswered Ask items that landed today.
 * Empty on a quiet day — the job file should not invent a strip.
 */
export function jobFileToday(input: {
  proofs?: ProofResponse | null;
  scope?: JobScopeItem[] | null;
  questions?: ProofQuestion[] | null;
  now?: Date;
}): JobFileTodayChange {
  const day = localDayKey(input.now ?? new Date());
  const clips = (input.proofs?.videos ?? []).filter((video) => clipLandedToday(video, day));
  const scope = (input.scope ?? []).filter((item) => isoOnLocalDay(item.created_at, day));
  const unanswered = (input.questions ?? []).filter(
    (question) => unansweredAsk(question) && isoOnLocalDay(question.created_at, day),
  );
  return { clips, scope, unansweredAsk: unanswered };
}

export function jobFileTodayHasChange(change: JobFileTodayChange): boolean {
  return change.clips.length > 0 || change.scope.length > 0 || change.unansweredAsk.length > 0;
}

export function pluralCount(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
