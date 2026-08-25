import { localDayKey } from '../pm/psychrometrics.js';

/**
 * Today's work for Field Capture and the office dashboard.
 *
 * Opening the app has to answer one question: which job are we on today.
 * That is not "every open job in the org". It is the job scheduled for this
 * calendar day, the job already filmed today, or the job currently in
 * progress — and a filmed-today job still counts after it is marked complete.
 */

export const DEFAULT_FIELD_TIMEZONE = 'America/New_York';

const CLOSED = new Set(['cancelled']);
const OPEN = new Set(['draft', 'scheduled', 'in_progress', 'on_hold']);

export type TodayReason = 'filmed' | 'scheduled' | 'in_progress' | 'open';

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

function reasonFor(
  job: TodayJobInput,
  filmedIds: Set<string>,
  day: string,
  timeZone: string,
): TodayReason | null {
  if (CLOSED.has(job.status ?? '')) return filmedIds.has(job.id) ? 'filmed' : null;
  if (filmedIds.has(job.id)) return 'filmed';
  if (fallsOnDay(job.scheduledStart, day, timeZone)) return 'scheduled';
  if (job.status === 'in_progress') return 'in_progress';
  return null;
}

const REASON_RANK: Record<TodayReason, number> = {
  filmed: 0,
  scheduled: 1,
  in_progress: 2,
  open: 3,
};

function startMs(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

/**
 * Pick the jobs that belong on today's screen.
 *
 * When nothing is scheduled, filmed, or in progress, fall back to other open
 * jobs so a crew can still start filming. Cancelled jobs stay out unless they
 * already have a film for today.
 */
export function pickTodayJobs(
  jobs: TodayJobInput[],
  filmedJobIds: Iterable<string>,
  day: string,
  timeZone: string = DEFAULT_FIELD_TIMEZONE,
): PickedTodayJob[] {
  const filmed = new Set(filmedJobIds);
  const today: PickedTodayJob[] = [];
  const fallback: PickedTodayJob[] = [];

  for (const job of jobs) {
    const reason = reasonFor(job, filmed, day, timeZone);
    if (reason) {
      today.push({ ...job, filmed: filmed.has(job.id), reason });
      continue;
    }
    if (OPEN.has(job.status ?? '')) {
      fallback.push({ ...job, filmed: false, reason: 'open' });
    }
  }

  const list = today.length ? today : fallback;
  return list.sort((a, b) => {
    const rank = REASON_RANK[a.reason] - REASON_RANK[b.reason];
    if (rank !== 0) return rank;
    const byStart = startMs(a.scheduledStart) - startMs(b.scheduledStart);
    if (byStart !== 0) return byStart;
    return (a.title ?? '').localeCompare(b.title ?? '');
  });
}

export function formatTodayAt(
  scheduledStart: string | null,
  filmed: boolean,
  timeZone: string = DEFAULT_FIELD_TIMEZONE,
): string {
  if (filmed) return 'Filmed';
  if (!scheduledStart) return 'Today';
  try {
    return new Date(scheduledStart).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timeZone || DEFAULT_FIELD_TIMEZONE,
    });
  } catch {
    return 'Today';
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
