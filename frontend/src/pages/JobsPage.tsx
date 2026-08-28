import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  ApiError,
  JOB_STATUS_LABELS,
  JOB_STATUS_STYLES,
  JOB_PRIORITY_LABELS,
  JOB_PRIORITY_STYLES,
  WORK_TYPE_LABELS,
  formatMinutes,
  timeAgo,
  type JobSummary,
} from '../lib/api';
import { jobFileMatchesQuery } from '../lib/jobFileSearch';
import { PageHeader, PanelSpinner, EmptyState, ErrorNote } from '../components/AppShell';
import { SearchIcon } from '../components/icons';
import { useFeatureTimer } from '../hooks/useFeatureTimer';

const FILTERS: { value: string; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'all', label: 'All' },
];

const inputClass =
  'w-full rounded-lg border border-line glass-field px-3 py-2 text-sm text-ink-900 placeholder:text-ink-500 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400';

function JobCard({ job }: { job: JobSummary }) {
  const progress = job.taskCount ? Math.round((job.tasksDone / job.taskCount) * 100) : 0;
  const showStatus = job.status !== 'scheduled';

  return (
    <Link
      to={`/jobs/${job.jobId}`}
      className="block rounded-xl glass-card p-5 transition hover:border-brand-400/40 hover:bg-paper-200"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs tracking-wider text-brand-300">#{job.jobNumber}</p>
          <h3 className="mt-0.5 truncate text-base font-semibold text-ink-900">{job.title}</h3>
        </div>
        {showStatus && (
          <span
            className={`rounded-full border px-2.5 py-1 text-xs font-medium ${JOB_STATUS_STYLES[job.status]}`}
          >
            {JOB_STATUS_LABELS[job.status]}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-500">
        <span>{WORK_TYPE_LABELS[job.workType]}</span>
        <span className={JOB_PRIORITY_STYLES[job.priority]}>{JOB_PRIORITY_LABELS[job.priority]}</span>
        <span>
          {job.tasksDone}/{job.taskCount} tasks
        </span>
        <span>
          {job.crewSize} on crew
        </span>
        {job.minutesLogged > 0 && <span>{formatMinutes(job.minutesLogged)} logged</span>}
        <span>{job.eventCount} recorded</span>
      </div>

      {job.taskCount > 0 && (
        <div
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-paper-300"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${job.jobNumber} task progress`}
        >
          <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}

      {job.lastEvent && (
        <p className="mt-3 truncate text-xs text-ink-600">
          <span className="text-ink-500">Last:</span> {job.lastEvent}{' '}
          <span className="text-ink-500">· {timeAgo(job.lastEventAt)}</span>
        </p>
      )}
    </Link>
  );
}

export function JobsPage() {
  useFeatureTimer('jobs');
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [status, setStatus] = useState('open');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { jobs } = await api.getJobs({ status });
      setJobs(jobs);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load jobs.');
      setJobs([]);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(
    () => (jobs ?? []).filter((job) => jobFileMatchesQuery(job, search)),
    [jobs, search],
  );

  return (
    <>
      <PageHeader
        title="Job Files"
        description="Every job file the organization has opened. Each one carries its own complete history."
      />

      <div className="mb-5 space-y-3">
        <div className="relative max-w-[520px]">
          <SearchIcon
            width={14}
            height={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-500"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by job, company, date, address, ID, or hash"
            aria-label="Search job files"
            className={`${inputClass} h-[34px] py-0 pl-[30px]`}
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => {
                setStatus(f.value);
                setJobs(null);
              }}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                status === f.value
                  ? 'bg-brand-600 text-ink-900'
                  : 'border border-line text-ink-600 hover:bg-paper-200 hover:text-ink-800'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      )}

      {jobs === null ? (
        <PanelSpinner label="Loading jobs" />
      ) : visible.length === 0 ? (
        <EmptyState
          title={search ? 'No job files match that search.' : 'No job files yet.'}
          hint={search ? undefined : 'Start a job from the rail and it will show up here.'}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((job) => (
            <JobCard key={job.jobId} job={job} />
          ))}
        </div>
      )}
    </>
  );
}
