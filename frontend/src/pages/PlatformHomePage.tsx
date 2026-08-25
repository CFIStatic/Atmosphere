import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type JobSummary } from '../lib/api';
import { METRIC_LABELS, type MetricKey } from '../lib/platforms';
import { AlertIcon } from '../components/icons';
import { useFeatureTimer } from '../hooks/useFeatureTimer';

const OPEN_STATUSES = new Set(['draft', 'scheduled', 'in_progress', 'on_hold']);

function isToday(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

const PHASE_LABEL: Record<string, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  on_hold: 'On hold',
  completed: 'Completed',
  invoiced: 'Invoiced',
  paid: 'Paid',
};

/**
 * Office Overview — what the organization is doing today.
 *
 * This is the admin view from the office, not a technician's personal day.
 * It sits beside the permanent Dashboard rail.
 */
export function PlatformHomePage() {
  useFeatureTimer('office_overview');
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getJobs({ status: 'all' })
      .then(({ jobs: next }) => {
        if (!cancelled) setJobs(next);
      })
      .catch(() => {
        if (!cancelled) setJobs([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const open = useMemo(() => (jobs ?? []).filter((j) => OPEN_STATUSES.has(j.status)), [jobs]);
  const today = useMemo(
    () =>
      (jobs ?? []).filter(
        (j) =>
          j.status !== 'cancelled' &&
          (isToday(j.scheduledStart) || isToday(j.lastEventAt) || j.status === 'in_progress'),
      ),
    [jobs],
  );
  const blocked = useMemo(() => open.filter((j) => j.status === 'on_hold'), [open]);

  const metricValue = (key: MetricKey): { value: string; sub: string } => {
    switch (key) {
      case 'openJobs':
        return { value: jobs ? String(open.length) : '—', sub: METRIC_LABELS[key].hint };
      case 'crewOnJobs':
        return {
          value: jobs ? String(open.reduce((s, j) => s + j.crewSize, 0)) : '—',
          sub: METRIC_LABELS[key].hint,
        };
      case 'scheduledToday':
        return { value: jobs ? String(today.length) : '—', sub: 'Jobs with work on the calendar or already underway' };
      case 'unscheduled':
        return { value: jobs ? String(open.filter((j) => !j.scheduledStart).length) : '—', sub: METRIC_LABELS[key].hint };
    }
  };

  const board = useMemo(() => {
    const pool = today.length ? today : open;
    return [...pool].sort((a, b) => {
      const aHold = a.status === 'on_hold' ? 0 : 1;
      const bHold = b.status === 'on_hold' ? 0 : 1;
      if (aHold !== bHold) return aHold - bHold;
      const aLive = a.status === 'in_progress' ? 0 : 1;
      const bLive = b.status === 'in_progress' ? 0 : 1;
      if (aLive !== bLive) return aLive - bLive;
      const at = a.scheduledStart ? Date.parse(a.scheduledStart) : Number.MAX_SAFE_INTEGER;
      const bt = b.scheduledStart ? Date.parse(b.scheduledStart) : Number.MAX_SAFE_INTEGER;
      return at - bt;
    });
  }, [today, open]);

  return (
    <div>
      <p className="text-sm font-medium text-brand-600">Overview</p>
      <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-ink-900">The day across the office</h1>
      <p className="mt-1 max-w-2xl text-sm text-ink-600">
        Every crew in the field today, what is underway, and what is blocked — for the office, not
        one technician.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(['scheduledToday', 'crewOnJobs', 'openJobs', 'unscheduled'] as MetricKey[]).map((key) => {
          const { value, sub } = metricValue(key);
          const label = key === 'scheduledToday' ? 'In the field today' : METRIC_LABELS[key].label;
          return <Kpi key={key} label={label} value={value} sub={sub} />;
        })}
      </div>

      {blocked.length > 0 && (
        <p className="mt-4 text-sm text-danger-600">
          {blocked.length} job{blocked.length === 1 ? '' : 's'} on hold.
        </p>
      )}

      <section className="mt-6 rounded-xl glass-card">
        <header className="flex items-baseline justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-ink-900">Today&apos;s work</h2>
            <p className="mt-0.5 text-xs text-ink-500">
              {jobs
                ? board.length
                  ? `${board.length} job${board.length === 1 ? '' : 's'} with work today`
                  : 'No jobs are scheduled or underway today'
                : 'Loading…'}
            </p>
          </div>
          <Link to="/jobs" className="text-xs font-medium text-brand-600 hover:text-brand-700">
            My jobs
          </Link>
        </header>
        <div>
          {board.map((job) => (
            <OfficeJobRow key={job.jobId} job={job} />
          ))}
          {jobs && board.length === 0 && (
            <p className="px-5 py-8 text-sm text-ink-500">Nothing on the board for today.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl glass-card px-4 py-3.5 shadow-card">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">{label}</p>
      <p className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight text-ink-900">{value}</p>
      {sub && <p className="mt-1 truncate text-xs text-ink-500">{sub}</p>}
    </div>
  );
}

function OfficeJobRow({ job }: { job: JobSummary }) {
  const blocked = job.status === 'on_hold';
  const critical = job.priority === 1;

  return (
    <Link
      to={`/jobs/${job.jobId}`}
      className="flex items-start gap-3 border-b border-line px-5 py-3.5 transition last:border-b-0 hover:bg-paper-200"
    >
      <AlertIcon
        width={15}
        height={15}
        className={`mt-0.5 shrink-0 ${blocked || critical ? 'text-danger-600' : 'text-ink-500'}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-ink-500">#{job.jobNumber}</span>
          <span className="truncate text-sm font-semibold text-ink-900">{job.title}</span>
          {blocked && (
            <span className="rounded-full bg-danger-50 px-2 py-0.5 text-[11px] font-semibold text-danger-600">
              On hold
            </span>
          )}
          <span className="rounded-full bg-paper-200 px-2 py-0.5 text-[11px] font-medium text-ink-600">
            {PHASE_LABEL[job.status] ?? job.status}
          </span>
        </div>
        {job.lastEvent && <p className="mt-1 truncate text-[13px] text-ink-600">{job.lastEvent}</p>}
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold tabular-nums text-ink-900">
          {job.scheduledStart
            ? new Date(job.scheduledStart).toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
              })
            : 'Unscheduled'}
        </p>
        <p className="mt-0.5 text-xs text-ink-500">
          {job.crewSize} on crew{job.crewSize === 1 ? '' : 's'}
        </p>
      </div>
    </Link>
  );
}
