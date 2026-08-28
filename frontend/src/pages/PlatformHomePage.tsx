import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, JOB_STATUS_LABELS, WORK_TYPE_LABELS, usd, type JobSummary } from '../lib/api';
import { displayName } from '../lib/display';
import { jobFilePath } from '../lib/jobFileAsk';
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

function daysStale(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.floor(ms / 86_400_000);
}

/**
 * Corporate overview — what is happening across the business, not a field
 * dispatch board and not a restoration dashboard of one job.
 */
export function PlatformHomePage({ platform: _platform }: { platform: string }) {
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
  const workedToday = useMemo(
    () =>
      (jobs ?? []).filter(
        (j) => j.status !== 'cancelled' && (isToday(j.lastEventAt) || j.status === 'in_progress'),
      ).length,
    [jobs],
  );
  const crew = open.reduce((s, j) => s + j.crewSize, 0);
  const contracted = (jobs ?? []).reduce((s, j) => s + (j.contractAmount ?? 0), 0);
  const invoiced = (jobs ?? []).reduce((s, j) => s + (j.invoicedAmount ?? 0), 0);
  const paid = (jobs ?? []).reduce((s, j) => s + (j.paidAmount ?? 0), 0);
  const outstanding = Math.max(0, invoiced - paid);

  const mix = useMemo(() => {
    const counts = { mitigation: 0, construction: 0 };
    for (const job of open) {
      if (job.workType === 'construction') counts.construction += 1;
      else counts.mitigation += 1;
    }
    return counts;
  }, [open]);

  const attention = useMemo(() => {
    return [...open]
      .map((job) => {
        const stale = daysStale(job.lastEventAt);
        const score =
          (job.status === 'on_hold' ? 4 : 0) +
          (job.priority === 1 ? 3 : 0) +
          (stale != null && stale >= 3 ? 2 : 0);
        return { job, score, stale };
      })
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score || (b.job.lastEventAt ?? '').localeCompare(a.job.lastEventAt ?? ''))
      .slice(0, 8);
  }, [open]);

  const recent = useMemo(() => {
    return [...open]
      .sort(
        (a, b) =>
          Date.parse(b.lastEventAt ?? b.updatedAt) - Date.parse(a.lastEventAt ?? a.updatedAt),
      )
      .slice(0, 10);
  }, [open]);

  return (
    <div data-testid="company-overview">
      <div>
        <p className="text-sm font-medium text-brand-600">Company overview</p>
        <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-ink-900">
          Good to see you, {firstName}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-600">
          What is happening across the business — every open job, crew, and dollar. Open a job file
          when you need the detail.
        </p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Active jobs" value={jobs ? String(open.length) : '—'} sub="Open across the company" />
        <Kpi label="Crew assigned" value={jobs ? String(crew) : '—'} sub="People on open jobs" />
        <Kpi label="Worked today" value={jobs ? String(workedToday) : '—'} sub="Filmed or in progress today" />
        <Kpi label="Contracted" value={jobs ? usd(contracted) : '—'} sub="On the books" />
        <Kpi label="Invoiced" value={jobs ? usd(invoiced) : '—'} sub="Billed to date" />
        <Kpi label="Outstanding" value={jobs ? usd(outstanding) : '—'} sub="Invoiced less collected" />
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs text-ink-600">
        <span className="rounded-full border border-line bg-paper-0 px-3 py-1">
          {WORK_TYPE_LABELS.mitigation}: {jobs ? mix.mitigation : '—'}
        </span>
        <span className="rounded-full border border-line bg-paper-0 px-3 py-1">
          {WORK_TYPE_LABELS.construction}: {jobs ? mix.construction : '—'}
        </span>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl glass-card">
          <header className="flex items-baseline justify-between border-b border-line px-5 py-4">
            <div>
              <h2 className="text-[15px] font-semibold text-ink-900">Needs attention</h2>
              <p className="mt-0.5 text-xs text-ink-500">
                {jobs
                  ? attention.length
                    ? `${attention.length} job${attention.length === 1 ? '' : 's'} off the happy path`
                    : 'Nothing needs a decision right now'
                  : 'Loading…'}
              </p>
            </div>
            <Link to="/jobs" className="text-xs font-medium text-brand-600 hover:text-brand-700">
              Job files
            </Link>
          </header>
          <div>
            {attention.map(({ job, stale }) => (
              <AttentionRow key={job.jobId} job={job} stale={stale} />
            ))}
            {jobs && attention.length === 0 && (
              <p className="px-5 py-8 text-sm text-ink-500">Every open job is moving.</p>
            )}
          </div>
        </section>

        <section className="rounded-xl glass-card">
          <header className="border-b border-line px-5 py-4">
            <h2 className="text-[15px] font-semibold text-ink-900">Across the business</h2>
            <p className="mt-0.5 text-xs text-ink-500">Every open job in the company</p>
          </header>
          <div>
            {recent.map((job) => (
              <Link
                key={job.jobId}
                to={jobFilePath(job.jobId, { title: job.title, number: job.jobNumber })}
                className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5 last:border-b-0 hover:bg-paper-200"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink-900">{job.title}</p>
                  <p className="mt-0.5 truncate text-[13px] text-ink-600">
                    {job.lastEvent || 'Opened — nothing filmed yet'}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] text-ink-400">#{job.jobNumber}</span>
              </Link>
            ))}
            {jobs && recent.length === 0 && (
              <p className="px-5 py-8 text-sm text-ink-500">Nothing recorded yet.</p>
            )}
          </div>
        </section>
      </div>
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

function AttentionRow({ job, stale }: { job: JobSummary; stale: number | null }) {
  const blocked = job.status === 'on_hold';
  const urgent = job.priority === 1;

  return (
    <Link
      to={jobFilePath(job.jobId, { title: job.title, number: job.jobNumber })}
      className="flex items-start gap-3 border-b border-line px-5 py-3.5 transition last:border-b-0 hover:bg-paper-200"
    >
      <AlertIcon
        width={15}
        height={15}
        className={`mt-0.5 shrink-0 ${blocked || urgent ? 'text-danger-600' : 'text-ink-500'}`}
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
          {urgent && (
            <span className="rounded-full bg-caution-50 px-2 py-0.5 text-[11px] font-semibold text-caution-600">
              Urgent
            </span>
          )}
          <span className="rounded-full bg-paper-200 px-2 py-0.5 text-[11px] font-medium text-ink-600">
            {JOB_STATUS_LABELS[job.status] ?? job.status}
          </span>
        </div>
        <p className="mt-1 truncate text-[13px] text-ink-600">
          {job.lastEvent || 'No movement yet'}
          {stale != null && stale >= 3 ? ` · ${stale}d quiet` : ''}
        </p>
      </div>
    </Link>
  );
}
