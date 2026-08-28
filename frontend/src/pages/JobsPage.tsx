/**
 * Office My jobs — the company's job files.
 *
 * The rail label is My jobs; each card is a file you open to ask what was
 * filmed. Crews have a different My jobs at /my-jobs (claimed links, no org
 * seat). Start a job is how a file gets here — not a second create form.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  ApiError,
  JOB_STATUS_LABELS,
  JOB_STATUS_STYLES,
  WORK_TYPE_LABELS,
  timeAgo,
  type JobSummary,
} from '../lib/api';
import { PageHeader, PanelSpinner, EmptyState, ErrorNote } from '../components/AppShell';
import { PlusIcon } from '../components/icons';
import { useFeatureTimer } from '../hooks/useFeatureTimer';

const FILTERS: { value: string; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'all', label: 'All' },
];

const inputClass =
  'w-full rounded-lg border border-line glass-field px-3 py-2 text-sm text-ink-900 placeholder:text-ink-500 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400';

function JobCard({ job }: { job: JobSummary }) {
  const filmed = job.eventCount > 0 || Boolean(job.lastEvent);

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
        <span
          className={`rounded-full border px-2.5 py-1 text-xs font-medium ${JOB_STATUS_STYLES[job.status]}`}
        >
          {JOB_STATUS_LABELS[job.status]}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-500">
        <span>{WORK_TYPE_LABELS[job.workType]}</span>
        <span>
          {filmed
            ? `${job.eventCount} ${job.eventCount === 1 ? 'clip' : 'clips'} on file`
            : 'Nothing filmed yet'}
        </span>
      </div>

      <p className="mt-3 truncate text-xs text-ink-600">
        {job.lastEvent ? (
          <>
            <span className="text-ink-500">Last:</span> {job.lastEvent}{' '}
            <span className="text-ink-500">· {timeAgo(job.lastEventAt)}</span>
          </>
        ) : (
          <span className="text-ink-500">Open to ask, invite, or wait for film.</span>
        )}
      </p>
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
      const { jobs } = await api.getJobs({ status, q: search || undefined });
      setJobs(jobs);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load jobs.');
      setJobs([]);
    }
  }, [status, search]);

  useEffect(() => {
    // Debounced so typing in the search box does not fire a request per keystroke.
    const timer = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  return (
    <>
      <PageHeader
        title="My jobs"
        description="Every job file the office has opened. Open one to ask what was filmed — or start a job if it is not here yet."
        action={
          <Link
            to="/intake"
            className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-500"
          >
            <PlusIcon width={17} height={17} />
            Start a job
          </Link>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
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
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search job files…"
          aria-label="Search job files"
          className={`ml-auto sm:max-w-xs ${inputClass}`}
        />
      </div>

      {error && (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      )}

      {jobs === null ? (
        <PanelSpinner label="Loading jobs" />
      ) : jobs.length === 0 ? (
        <EmptyState
          title={search ? 'No jobs match that search.' : 'No job files yet.'}
          hint={search ? undefined : 'Start a job and the file is ready before anyone films.'}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {jobs.map((job) => (
            <JobCard key={job.jobId} job={job} />
          ))}
        </div>
      )}
    </>
  );
}
