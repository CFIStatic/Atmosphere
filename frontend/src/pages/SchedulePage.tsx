import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type JobSummary } from '../lib/api';
import { AppShell, EmptyState, PageHeader, PanelSpinner } from '../components/AppShell';

const OPEN_STATUSES = new Set(['draft', 'scheduled', 'in_progress', 'on_hold']);

/**
 * The schedule: open jobs laid out by their scheduled start. It reads from
 * the same job list as everything else — a job with no date sits in the
 * unscheduled bucket, which is itself the to-do list that matters.
 */
export function SchedulePage() {
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getJobs({ status: 'open' })
      .then(({ jobs }) => !cancelled && setJobs(jobs))
      .catch(() => !cancelled && setJobs([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const { byDay, unscheduled } = useMemo(() => {
    const open = (jobs ?? []).filter((j) => OPEN_STATUSES.has(j.status));
    const dated = open.filter((j) => j.scheduledStart);
    const groups = new Map<string, JobSummary[]>();
    for (const job of dated.sort(
      (a, b) => Date.parse(a.scheduledStart!) - Date.parse(b.scheduledStart!),
    )) {
      const day = new Date(job.scheduledStart!).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      });
      const list = groups.get(day) ?? [];
      list.push(job);
      groups.set(day, list);
    }
    return { byDay: groups, unscheduled: open.filter((j) => !j.scheduledStart) };
  }, [jobs]);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Delivery"
        title="Schedule"
        description="Open jobs by their scheduled start. A job with no date is work nobody has committed to yet — that bucket is the one to empty."
      />

      {jobs === null && <PanelSpinner label="Loading the schedule" />}

      {jobs !== null && byDay.size === 0 && unscheduled.length === 0 && (
        <EmptyState
          title="Nothing on the books"
          hint="Jobs appear here as soon as they carry a scheduled start."
        />
      )}

      <div className="space-y-6">
        {[...byDay.entries()].map(([day, dayJobs]) => (
          <section key={day}>
            <h2 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-500">
              {day}
            </h2>
            <div className="rounded-xl glass-card">
              {dayJobs.map((job) => (
                <ScheduleRow key={job.jobId} job={job} />
              ))}
            </div>
          </section>
        ))}

        {unscheduled.length > 0 && (
          <section>
            <h2 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-caution-600">
              Unscheduled — {unscheduled.length}
            </h2>
            <div className="rounded-xl border border-dashed border-line bg-paper-0">
              {unscheduled.map((job) => (
                <ScheduleRow key={job.jobId} job={job} />
              ))}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}

function ScheduleRow({ job }: { job: JobSummary }) {
  const time = job.scheduledStart
    ? new Date(job.scheduledStart).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;
  return (
    <Link
      to={`/jobs/${job.jobId}`}
      className="flex items-center gap-4 border-b border-line px-5 py-3.5 transition last:border-b-0 hover:bg-paper-200"
    >
      <span className="w-16 shrink-0 font-mono text-xs tabular-nums text-ink-500">
        {time ?? '—'}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink-900">
          <span className="mr-2 font-mono text-xs font-normal text-ink-500">#{job.jobNumber}</span>
          {job.title}
        </p>
        <p className="mt-0.5 text-xs text-ink-500">
          {job.crewSize} on crew · {job.tasksDone}/{job.taskCount} tasks done
        </p>
      </div>
      <span className="rounded-full bg-paper-200 px-2 py-0.5 text-[11px] font-medium text-ink-600">
        {job.status.replace(/_/g, ' ')}
      </span>
    </Link>
  );
}
