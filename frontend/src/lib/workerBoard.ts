import type { FieldTodayJob, JobSummary } from './api';
import { isOpenJob } from './companyOverview';
import { jobFilePath } from './jobFileAsk';
import { jobLooksDeletedFromLibrary } from './jobFileCopy';

export type TodayReason = FieldTodayJob['reason'];

export interface WorkerJobCard {
  id: string;
  number: string;
  name: string;
  address: string;
  at: string;
  status: string | null;
  filmed: boolean;
  reason: TodayReason;
  sharePath: string | null;
  href: string;
  filmHref: string;
  lastEvent: string | null;
  crewNames: string[];
  assignedToMe: boolean;
}

export interface CrewBoardRow {
  userId: string;
  name: string;
  jobs: Array<{ jobId: string; title: string; jobNumber: number | null; status: string }>;
}

/** Film from the job's invite when one exists; otherwise the in-console capture app. */
export function workerFilmHref(sharePath: string | null | undefined): string {
  const path = sharePath?.trim();
  return path ? path : '/technician';
}

function cardFromSummary(
  job: JobSummary,
  userId: string | null,
  extras?: Partial<WorkerJobCard>,
): WorkerJobCard {
  const crew = job.crew ?? [];
  return {
    id: job.jobId,
    number: job.jobNumber != null ? `#${job.jobNumber}` : '',
    name: job.title,
    address: extras?.address ?? '',
    at: extras?.at ?? '',
    status: job.status,
    filmed: extras?.filmed ?? false,
    reason: extras?.reason ?? (job.status === 'in_progress' ? 'in_progress' : 'open'),
    sharePath: extras?.sharePath ?? null,
    href: jobFilePath(job.jobId, { title: job.title, number: job.jobNumber }),
    filmHref: workerFilmHref(extras?.sharePath),
    lastEvent: job.lastEvent,
    crewNames: crew.map((person) => person.name),
    assignedToMe: Boolean(userId && crew.some((person) => person.userId === userId)),
  };
}

/**
 * Prefer the Field Capture today list (assigned jobs, or every open job until
 * someone is put on a crew). Fall back to the office job list when that call
 * is missing, so Field Capture still opens in demo or on a stale API.
 */
export function mergeWorkerJobs(
  today: FieldTodayJob[] | null,
  jobs: JobSummary[],
  userId: string | null,
): WorkerJobCard[] {
  const liveJobs = jobs.filter((job) => !jobLooksDeletedFromLibrary(job.lastEvent));
  const byId = new Map(liveJobs.map((job) => [job.jobId, job]));

  if (today) {
    // Job Files is the inventory. A Dashboard delete drops the file there;
    // do not keep a today card whose office row is gone or tombstoned.
    return today
      .filter((row) => byId.has(row.id))
      .map((row) => {
        const job = byId.get(row.id);
        const crew = job?.crew ?? [];
        return {
          id: row.id,
          number: row.number,
          name: row.name,
          address: row.address,
          at: row.at,
          status: row.status,
          filmed: row.filmed,
          reason: row.reason,
          sharePath: row.sharePath,
          href: jobFilePath(row.id, {
            title: row.name,
            number: row.number.replace(/^#/, '') || job?.jobNumber,
          }),
          filmHref: workerFilmHref(row.sharePath),
          lastEvent: job?.lastEvent ?? null,
          crewNames: crew.map((person) => person.name),
          assignedToMe: Boolean(userId && crew.some((person) => person.userId === userId)),
        };
      });
  }

  const open = liveJobs.filter(isOpenJob);
  const mine = userId
    ? open.filter((job) => (job.crew ?? []).some((p) => p.userId === userId))
    : [];
  return (mine.length ? mine : open).map((job) => cardFromSummary(job, userId));
}

/** Whether the list is "every open job" because this person is not on a crew. */
export function workerListIsUnassigned(cards: WorkerJobCard[], userId: string | null): boolean {
  if (!userId || cards.length === 0) return false;
  return cards.every((card) => !card.assignedToMe);
}

/** People on open jobs — the office picture of who is working. */
export function buildCrewBoard(jobs: JobSummary[]): CrewBoardRow[] {
  const byUser = new Map<string, CrewBoardRow>();
  for (const job of jobs.filter(
    (row) => isOpenJob(row) && !jobLooksDeletedFromLibrary(row.lastEvent),
  )) {
    for (const person of job.crew ?? []) {
      const row = byUser.get(person.userId) ?? {
        userId: person.userId,
        name: person.name,
        jobs: [],
      };
      row.jobs.push({
        jobId: job.jobId,
        title: job.title,
        jobNumber: job.jobNumber,
        status: job.status,
      });
      byUser.set(person.userId, row);
    }
  }
  return [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function reasonLabel(reason: TodayReason, filmed: boolean): string {
  if (filmed || reason === 'filmed') return 'Filmed today';
  if (reason === 'in_progress') return 'In progress';
  return 'Open';
}
