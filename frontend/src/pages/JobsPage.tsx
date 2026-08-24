import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  ApiError,
  JOB_STATUS_LABELS,
  JOB_STATUS_STYLES,
  JOB_PRIORITY_LABELS,
  JOB_PRIORITY_STYLES,
  LOSS_TYPE_LABELS,
  WORK_TYPE_LABELS,
  formatMinutes,
  timeAgo,
  type CreateJobInput,
  type JobSummary,
  type JobPriority,
  type LossType,
} from '../lib/api';
import { PageHeader, PanelSpinner, EmptyState, ErrorNote } from '../components/AppShell';
import { SpinnerIcon, PlusIcon } from '../components/icons';
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
const labelClass = 'block text-xs font-medium uppercase tracking-wide text-ink-500';

function NewJobForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [form, setForm] = useState<CreateJobInput>({ title: '', workType: 'mitigation' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof CreateJobInput>(key: K, value: CreateJobInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      // Blank optional fields are dropped rather than sent as '' — an empty
      // string is a value, and the memory would record it as one.
      const payload = Object.fromEntries(
        Object.entries(form).filter(([, v]) => v !== '' && v !== undefined),
      ) as unknown as CreateJobInput;
      await api.createJob(payload);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open that job.');
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mb-6 animate-fade-in-up rounded-xl glass-card p-5 backdrop-blur"
    >
      <h2 className="text-base font-semibold text-ink-900">Open a job</h2>
      <p className="mt-1 text-sm text-ink-600">
        The job number is assigned automatically, and everything from here on is recorded.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="job-name">
            Job name
          </label>
          <input
            id="job-name"
            required
            autoFocus
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="Burst pipe — 14 Alder St"
            className={`mt-1 ${inputClass}`}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="job-loss-type">
            Loss type
          </label>
          <select
            id="job-loss-type"
            value={form.lossType ?? ''}
            onChange={(e) => set('lossType', (e.target.value || undefined) as LossType | undefined)}
            className={`mt-1 ${inputClass}`}
          >
            <option value="">Not specified</option>
            {(Object.keys(LOSS_TYPE_LABELS) as LossType[]).map((v) => (
              <option key={v} value={v}>
                {LOSS_TYPE_LABELS[v]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="job-priority">
            Priority
          </label>
          <select
            id="job-priority"
            value={form.priority ?? 3}
            onChange={(e) => set('priority', Number(e.target.value) as JobPriority)}
            className={`mt-1 ${inputClass}`}
          >
            {([1, 2, 3, 4, 5] as JobPriority[]).map((v) => (
              <option key={v} value={v}>
                {JOB_PRIORITY_LABELS[v]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="mt-4">
          <ErrorNote message={error} />
        </div>
      )}

      <div className="mt-5 flex gap-3">
        <button
          type="submit"
          disabled={saving || form.title.trim().length < 2}
          className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:opacity-50"
        >
          {saving && <SpinnerIcon className="animate-spin" width={16} height={16} />}
          {saving ? 'Opening…' : 'Open job'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink-700 transition hover:bg-paper-200"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function JobCard({ job }: { job: JobSummary }) {
  const progress = job.taskCount ? Math.round((job.tasksDone / job.taskCount) * 100) : 0;

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
  const [creating, setCreating] = useState(false);
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
        description="Every job the organization has opened. Each one carries its own complete history."
        action={
          !creating && (
            <button
              onClick={() => setCreating(true)}
              className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-500"
            >
              <PlusIcon width={17} height={17} />
              Open a job
            </button>
          )
        }
      />

      {creating && (
        <NewJobForm
          onCreated={() => {
            setCreating(false);
            setJobs(null);
            void load();
          }}
          onCancel={() => setCreating(false)}
        />
      )}

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
          placeholder="Search jobs…"
          aria-label="Search jobs"
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
          title={search ? 'No jobs match that search.' : 'No jobs yet.'}
          hint={search ? undefined : 'Open one and the record starts from the first keystroke.'}
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
