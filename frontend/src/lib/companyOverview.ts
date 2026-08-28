import type { JobSummary } from './api';
import type { ProofPulse } from './api';

const OPEN_STATUSES = new Set(['draft', 'scheduled', 'in_progress', 'on_hold']);

export function isOpenJob(job: Pick<JobSummary, 'status'>): boolean {
  return OPEN_STATUSES.has(job.status);
}

export function isToday(iso: string | null, now = new Date()): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export function daysStale(iso: string | null, now = new Date()): number | null {
  if (!iso) return null;
  const ms = now.getTime() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.floor(ms / 86_400_000);
}

export interface AttentionRow {
  job: JobSummary;
  score: number;
  stale: number | null;
}

/**
 * Jobs off the happy path: blocked, urgent, gone quiet, or never started.
 * A draft sitting with no film is a company problem, not a field dispatch list.
 */
export function jobsNeedingAttention(jobs: JobSummary[], now = new Date()): AttentionRow[] {
  return jobs
    .filter(isOpenJob)
    .map((job) => {
      const stale = daysStale(job.lastEventAt, now);
      const score =
        (job.status === 'on_hold' ? 4 : 0) +
        (job.priority === 1 ? 3 : 0) +
        (stale != null && stale >= 3 ? 2 : 0);
      return { job, score, stale };
    })
    .filter((row) => row.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || (b.job.lastEventAt ?? '').localeCompare(a.job.lastEventAt ?? ''),
    )
    .slice(0, 8);
}

export function pipelineLine(pulse: ProofPulse | null): string {
  if (!pulse) return 'Loading the analysis pipeline…';
  if (pulse.clips === 0) return 'No clips on file yet';
  const parts = [`${pulse.read} read`];
  if (pulse.analysing > 0) parts.push(`${pulse.analysing} being read`);
  if (pulse.failed > 0) parts.push(`${pulse.failed} failed`);
  if (pulse.unread > 0) parts.push(`${pulse.unread} waiting`);
  if (pulse.heard > 0) parts.push(`${pulse.heard} with mic`);
  return `${pulse.clips} clip${pulse.clips === 1 ? '' : 's'} · ${parts.join(' · ')}`;
}
