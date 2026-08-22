import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, type JobSummary } from '../lib/api';
import { AppShell } from '../components/AppShell';
import { displayName } from '../lib/display';
import { METRIC_LABELS, PLATFORMS, type MetricKey, type PlatformId } from '../lib/platforms';
import { AlertIcon } from '../components/icons';

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

/**
 * Field home — today's jobs and the numbers a crew glances at before they film.
 */
export function PlatformHomePage({ platform: platformId }: { platform: PlatformId }) {
  const platform = PLATFORMS[platformId];
  const { user, profile } = useAuth();
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

  const firstName = displayName(profile?.fullName, user?.email).split(/[\s@]/)[0];
  const open = useMemo(() => (jobs ?? []).filter((j) => OPEN_STATUSES.has(j.status)), [jobs]);

  const metricValue = (key: MetricKey): { value: string; sub: string } => {
    const { hint } = METRIC_LABELS[key];
    switch (key) {
      case 'openJobs':
        return { value: jobs ? String(open.length) : '—', sub: hint };
      case 'crewOnJobs':
        return { value: jobs ? String(open.reduce((s, j) => s + j.crewSize, 0)) : '—', sub: hint };
      case 'scheduledToday':
        return { value: jobs ? String(open.filter((j) => isToday(j.scheduledStart)).length) : '—', sub: hint };
      case 'unscheduled':
        return { value: jobs ? String(open.filter((j) => !j.scheduledStart).length) : '—', sub: hint };
    }
  };

  const attention = useMemo(() => {
    const list = [...open];
    const workedToday = (jobs ?? []).filter(
      (j) =>
        j.status !== 'cancelled' &&
        (isToday(j.scheduledStart) || isToday(j.lastEventAt) || j.status === 'in_progress'),
    );
    const pool = workedToday.length ? workedToday : list;
    return [...pool]
      .sort((a, b) => {
        const aToday = isToday(a.lastEventAt) || isToday(a.scheduledStart) ? 0 : 1;
        const bToday = isToday(b.lastEventAt) || isToday(b.scheduledStart) ? 0 : 1;
        if (aToday !== bToday) return aToday - bToday;
        const at = a.scheduledStart ? Date.parse(a.scheduledStart) : Number.MAX_SAFE_INTEGER;
        const bt = b.scheduledStart ? Date.parse(b.scheduledStart) : Number.MAX_SAFE_INTEGER;
        return at - bt;
      })
      .slice(0, 8);
  }, [jobs, open]);

  return (
    <AppShell>
      <div>
        <p className="text-sm font-medium text-brand-600">{platform.name}</p>
        <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-ink-900">
          Good to see you, {firstName}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-600">{platform.homeBlurb}</p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {platform.metrics.map((key) => {
          const { value, sub } = metricValue(key);
          return <Kpi key={key} label={METRIC_LABELS[key].label} value={value} sub={sub} />;
        })}
      </div>

      <section className="mt-6 rounded-xl glass-card">
        <header className="flex items-baseline justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-ink-900">Today&apos;s jobs</h2>
            <p className="mt-0.5 text-xs text-ink-500">
              {jobs
                ? attention.length
                  ? `${attention.length} job${attention.length === 1 ? '' : 's'} for today`
                  : 'Nothing scheduled or filmed today'
                : 'Loading…'}
            </p>
          </div>
          <Link to="/jobs" className="text-xs font-medium text-brand-600 hover:text-brand-700">
            All jobs
          </Link>
        </header>
        <div>
          {attention.map((job) => (
            <AttentionRow key={job.jobId} job={job} />
          ))}
          {jobs && attention.length === 0 && (
            <p className="px-5 py-8 text-sm text-ink-500">Nothing here right now.</p>
          )}
        </div>
      </section>
    </AppShell>
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

const PHASE_LABEL: Record<string, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  on_hold: 'On hold',
  completed: 'Completed',
  invoiced: 'Invoiced',
  paid: 'Paid',
};

function AttentionRow({ job }: { job: JobSummary }) {
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
              Blocked
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
            ? new Date(job.scheduledStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : 'Unscheduled'}
        </p>
        <p className="mt-0.5 text-xs text-ink-500">{job.crewSize} on crew</p>
      </div>
    </Link>
  );
}
