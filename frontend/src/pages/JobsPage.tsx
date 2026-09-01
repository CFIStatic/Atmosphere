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
import { sortJobFilesByLastOpened } from '../lib/jobFileRecents';
import { visibleJobFiles } from '../lib/jobFileCopy';
import { jobFilePath } from '../lib/jobFileAsk';
import { useJobFilesSearch } from '../layouts/jobFilesSearch';
import { PanelSpinner, EmptyState, ErrorNote } from '../components/AppShell';
import { useFeatureTimer } from '../hooks/useFeatureTimer';

function JobCard({ job }: { job: JobSummary }) {
  const progress = job.taskCount ? Math.round((job.tasksDone / job.taskCount) * 100) : 0;
  const showStatus = job.status !== 'scheduled';

  return (
    <Link
      to={jobFilePath(job.jobId, { title: job.title, number: job.jobNumber })}
      className="block min-w-0 max-w-full overflow-hidden rounded-xl glass-card p-4 transition hover:border-brand-400/40 hover:bg-paper-200 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-ink-900">{job.title}</h3>
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
        <span className={JOB_PRIORITY_STYLES[job.priority]}>
          {JOB_PRIORITY_LABELS[job.priority]}
        </span>
        <span>
          {job.tasksDone}/{job.taskCount} tasks
        </span>
        <span>{job.crewSize} on crew</span>
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
          aria-label={`${job.title} task progress`}
        >
          <div
            className="h-full rounded-full bg-brand-500 transition-all"
            style={{ width: `${progress}%` }}
          />
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
  const { query } = useJobFilesSearch();
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { jobs: next } = await api.getJobs({ status: 'all' });
      setJobs(visibleJobFiles(next));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load jobs.');
      setJobs([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(
    () => sortJobFilesByLastOpened((jobs ?? []).filter((job) => jobFileMatchesQuery(job, query))),
    [jobs, query],
  );

  return (
    <>
      {error && (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      )}

      {jobs === null ? (
        <PanelSpinner label="Loading jobs" />
      ) : visible.length === 0 ? (
        <EmptyState
          title={query ? 'No job files match that search.' : 'No job files yet.'}
          hint={query ? undefined : 'Start a job from the rail and it will show up here.'}
        />
      ) : (
        <div className="grid min-w-0 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          {visible.map((job) => (
            <JobCard key={job.jobId} job={job} />
          ))}
        </div>
      )}
    </>
  );
}
