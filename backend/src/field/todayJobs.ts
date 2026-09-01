import { localDayKey } from '../pm/psychrometrics.js';

/**
 * Jobs Field Capture and the office overview can film.
 *
 * Opening the app has to answer one question: which job can we add video to.
 * That is every open job in the org — not only the ones with a start date —
 * plus anything already filmed today (those still count after they are marked
 * complete). A crew standing at a house must never be told the job is hidden
 * because nobody put it on a calendar.
 */

export const DEFAULT_FIELD_TIMEZONE = 'America/New_York';

const CLOSED = new Set(['cancelled']);
const OPEN = new Set(['draft', 'scheduled', 'in_progress', 'on_hold']);

export type TodayReason = 'filmed' | 'in_progress' | 'open';

export interface TodayJobInput {
  id: string;
  jobNumber: number | null;
  title: string | null;
  status: string | null;
  scheduledStart: string | null;
  propertyId: string | null;
}

export interface PickedTodayJob extends TodayJobInput {
  filmed: boolean;
  reason: TodayReason;
}

export function todayKey(now: Date = new Date(), timeZone: string = DEFAULT_FIELD_TIMEZONE): string {
  return localDayKey(now, timeZone || DEFAULT_FIELD_TIMEZONE);
}

export function fallsOnDay(iso: string | null | undefined, day: string, timeZone: string): boolean {
  if (!iso) return false;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return false;
  return localDayKey(t, timeZone) === day;
}

function reasonFor(job: TodayJobInput, filmedIds: Set<string>): TodayReason | null {
  if (CLOSED.has(job.status ?? '')) return filmedIds.has(job.id) ? 'filmed' : null;
  if (filmedIds.has(job.id)) return 'filmed';
  if (job.status === 'in_progress') return 'in_progress';
  if (OPEN.has(job.status ?? '')) return 'open';
  // Completed (and any other non-open status) stays off the list unless it
  // was filmed today — that case is handled above.
  return filmedIds.has(job.id) ? 'filmed' : null;
}

const REASON_RANK: Record<TodayReason, number> = {
  filmed: 0,
  in_progress: 1,
  open: 2,
};

function startMs(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

/**
 * List the jobs the crew can film.
 *
 * Every open job is offered so more video can be added at any time. Cancelled
 * jobs stay out unless they already have a film for today.
 */
export function pickTodayJobs(
  jobs: TodayJobInput[],
  filmedJobIds: Iterable<string>,
  _day?: string,
  _timeZone: string = DEFAULT_FIELD_TIMEZONE,
): PickedTodayJob[] {
  const filmed = new Set(filmedJobIds);
  const list: PickedTodayJob[] = [];

  for (const job of jobs) {
    const reason = reasonFor(job, filmed);
    if (!reason) continue;
    list.push({ ...job, filmed: filmed.has(job.id), reason });
  }

  return list.sort((a, b) => {
    const rank = REASON_RANK[a.reason] - REASON_RANK[b.reason];
    if (rank !== 0) return rank;
    const byStart = startMs(a.scheduledStart) - startMs(b.scheduledStart);
    if (byStart !== 0) return byStart;
    return (a.title ?? '').localeCompare(b.title ?? '');
  });
}

/**
 * Today-list address and map pin. Jobs without a property are name-only —
 * not "Address on file" and not unplaced.
 */
export function todayJobLocation(
  propertyId: string | null,
  address: string | undefined,
  filmed: boolean,
): { address: string; placed: boolean } {
  const line = (propertyId && address) || '';
  return {
    address: line,
    placed: Boolean(line) || !propertyId || filmed,
  };
}

export function formatTodayAt(
  scheduledStart: string | null,
  filmed: boolean,
  timeZone: string = DEFAULT_FIELD_TIMEZONE,
): string {
  if (filmed) return 'Filmed';
  if (!scheduledStart) return '';
  try {
    return new Date(scheduledStart).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timeZone || DEFAULT_FIELD_TIMEZONE,
    });
  } catch {
    return '';
  }
}

/** Office dashboard: the job worked today sits at the top of the folder list. */
export function sortJobsForOpen<T extends { jobId: string; createdAt?: string | null }>(
  jobs: T[],
  lastWorkDateByJob: Map<string, string>,
  day: string,
): T[] {
  const rank = (job: T): [number, string, string] => {
    const last = lastWorkDateByJob.get(job.jobId) ?? '';
    const today = last === day ? 0 : last ? 1 : 2;
    return [today, last, job.createdAt ?? ''];
  };
  return [...jobs].sort((a, b) => {
    const [ar, aLast, aCreated] = rank(a);
    const [br, bLast, bCreated] = rank(b);
    if (ar !== br) return ar - br;
    if (aLast !== bLast) return bLast.localeCompare(aLast);
    return bCreated.localeCompare(aCreated);
  });
}

/** A live invite on a job — the same token the office emailed. */
export interface JobPartyInvite {
  jobId: string;
  email: string | null;
  accessToken: string;
}

/**
 * Prefer the invite that was emailed to this person. Do not fall back to
 * another crew's token — that would open someone else's job record.
 */
export function pickInviteToken(
  parties: JobPartyInvite[],
  jobId: string,
  email: string | null | undefined,
): string | null {
  const want = email?.trim().toLowerCase() ?? '';
  if (!want) return null;
  const match = parties.find(
    (p) => p.jobId === jobId && p.accessToken && (p.email ?? '').trim().toLowerCase() === want,
  );
  return match?.accessToken ?? null;
}
