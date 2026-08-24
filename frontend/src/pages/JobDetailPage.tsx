import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  api,
  ApiError,
  ASSIGNMENT_ROLE_LABELS,
  JOB_STATUS_LABELS,
  JOB_STATUS_STYLES,
  LOSS_TYPE_LABELS,
  JOB_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  WORK_LOG_KIND_LABELS,
  WORK_TYPE_LABELS,
  displayName,
  formatMinutes,
  timeAgo,
  type JobDetail,
  type JobStatus,
  type JobTask,
  type OrgMember,
  type TaskStatus,
  type WorkLogKind,
} from '../lib/api';
import { PanelSpinner, ErrorNote, EmptyState } from '../components/AppShell';
import { MemoryFeed } from '../components/MemoryFeed';
import { SpinnerIcon, PlusIcon, ChevronLeftIcon, CheckIcon } from '../components/icons';
import { useFeatureTimer } from '../hooks/useFeatureTimer';

const inputClass =
  'w-full rounded-lg border border-line glass-field px-3 py-2 text-sm text-ink-900 placeholder:text-ink-500 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400';

const TABS = ['Work', 'Crew', 'History'] as const;
type Tab = (typeof TABS)[number];

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl glass-card p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-ink-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Tasks                                                                       */
/* -------------------------------------------------------------------------- */

function TaskRow({
  task,
  members,
  onChange,
}: {
  task: JobTask;
  members: OrgMember[];
  onChange: (patch: { status?: TaskStatus; assignedTo?: string | null }) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const done = task.status === 'done';

  async function run(patch: { status?: TaskStatus; assignedTo?: string | null }) {
    setBusy(true);
    try {
      await onChange(patch);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <button
        onClick={() => run({ status: done ? 'todo' : 'done' })}
        disabled={busy}
        aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
        className={`grid h-5 w-5 shrink-0 place-items-center rounded border transition disabled:opacity-50 ${
          done
            ? 'border-success-200 bg-success-50 text-success-600'
            : 'border-line-strong text-transparent hover:border-brand-400'
        }`}
      >
        <CheckIcon width={13} height={13} />
      </button>

      <div className="min-w-0 flex-1">
        <p className={`text-sm ${done ? 'text-ink-500 line-through' : 'text-ink-800'}`}>
          {task.title}
        </p>
        <p className="mt-0.5 text-xs text-ink-500">
          {TASK_STATUS_LABELS[task.status]}
          {task.dueAt && ` · due ${new Date(task.dueAt).toLocaleDateString()}`}
          {task.completedAt && ` · completed ${timeAgo(task.completedAt)}`}
        </p>
      </div>

      <select
        value={task.assignedTo ?? ''}
        onChange={(e) => run({ assignedTo: e.target.value || null })}
        disabled={busy}
        aria-label={`Assign ${task.title}`}
        className="rounded-lg border border-line bg-paper-50 px-2 py-1.5 text-xs text-ink-700 focus:border-brand-400 focus:outline-none disabled:opacity-50"
      >
        <option value="">Unassigned</option>
        {members.map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.fullName || m.email}
          </option>
        ))}
      </select>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export function JobDetailPage() {
  useFeatureTimer('job_detail');
  const { id = '' } = useParams();
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [tab, setTab] = useState<Tab>('Work');
  const [error, setError] = useState<string | null>(null);

  const [newTask, setNewTask] = useState('');
  const [addingTask, setAddingTask] = useState(false);
  const [logBody, setLogBody] = useState('');
  const [logKind, setLogKind] = useState<WorkLogKind>('work');
  const [logMinutes, setLogMinutes] = useState('');
  const [savingLog, setSavingLog] = useState(false);
  const [crewId, setCrewId] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      setDetail(await api.getJob(id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load that job.');
    }
  }, [id]);

  useEffect(() => {
    void load();
    api
      .getMembers()
      .then(({ members }) => setMembers(members))
      .catch(() => setMembers([]));
  }, [load]);

  /** Every mutation reloads: the memory panel has to reflect what just happened. */
  async function mutate(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not go through.');
    }
  }

  if (error && !detail) {
    return (
      <div className="mx-auto max-w-lg pt-10">
        <ErrorNote message={error} />
        <Link to="/jobs" className="mt-4 inline-block text-sm text-brand-300 hover:text-brand-200">
          ← Back to jobs
        </Link>
      </div>
    );
  }

  if (!detail) {
    return <PanelSpinner label="Loading job" />;
  }

  const { job, tasks, crew, workLogs, memory } = detail;
  const activeCrew = crew.filter((c) => c.active);
  const totalMinutes = workLogs.reduce((sum, w) => sum + (w.minutes ?? 0), 0);
  const unassigned = members.filter((m) => !activeCrew.some((c) => c.userId === m.userId));

  return (
    <>
      <Link>
        to="/jobs"
        className="mb-4 inline-flex items-center gap-1 text-sm text-ink-600 transition hover:text-ink-800"
      >
        <ChevronLeftIcon width={16} height={16} />
        All jobs
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-sm tracking-wider text-brand-300">Job #{job.jobNumber}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">{job.title}</h1>
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-ink-600">
            <span>{WORK_TYPE_LABELS[job.workType]}</span>
            {job.lossType && <span>· {LOSS_TYPE_LABELS[job.lossType]}</span>}
            <span>· {JOB_PRIORITY_LABELS[job.priority]} priority</span>
            {job.claimNumber && <span>· Claim {job.claimNumber}</span>}
            {job.policyNumber && <span>· Policy {job.policyNumber}</span>}
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <span
            className={`rounded-full border px-3 py-1 text-xs font-medium ${JOB_STATUS_STYLES[job.status]}`}
          >
            {JOB_STATUS_LABELS[job.status]}
          </span>
          <select
            value={job.status}
            onChange={(e) => mutate(() => api.updateJob(job.id, { status: e.target.value as JobStatus }))}
            aria-label="Change job status"
            className="rounded-lg border border-line bg-paper-50 px-3 py-1.5 text-xs text-ink-700 focus:border-brand-400 focus:outline-none"
          >
            {(Object.keys(JOB_STATUS_LABELS) as JobStatus[]).map((s) => (
              <option key={s} value={s}>
                {JOB_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Numbers */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Tasks', value: `${tasks.filter((t) => t.status === 'done').length}/${tasks.length}` },
          { label: 'Crew', value: String(activeCrew.length) },
          { label: 'Logged', value: formatMinutes(totalMinutes) },
          { label: 'Recorded', value: String(memory.length) },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl glass-card px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{stat.label}</p>
            <p className="mt-1 text-xl font-semibold text-ink-900">{stat.value}</p>
          </div>
        ))}
      </div>

      {error && (
        <div className="mt-4">
          <ErrorNote message={error} />
        </div>
      )}

      {/* Tabs */}
      <div className="mt-6 flex gap-1 border-b border-line" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`border-b-2 px-4 py-2.5 text-sm font-medium transition ${
              tab === t
                ? 'border-brand-400 text-ink-900'
                : 'border-transparent text-ink-600 hover:text-ink-800'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="mt-6 space-y-6">
        {tab === 'Work' && (
          <>
            <Card title="Tasks">
              <form
                className="mb-4 flex gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (newTask.trim().length < 2) return;
                  setAddingTask(true);
                  await mutate(() => api.createTask(job.id, { title: newTask.trim() }));
                  setNewTask('');
                  setAddingTask(false);
                }}
              >
                <input
                  value={newTask}
                  onChange={(e) => setNewTask(e.target.value)}
                  placeholder="Add a task…"
                  aria-label="New task"
                  className={inputClass}
                />
                <button
                  type="submit"
                  disabled={addingTask || newTask.trim().length < 2}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:opacity-50"
                >
                  {addingTask ? (
                    <SpinnerIcon className="animate-spin" width={16} height={16} />
                  ) : (
                    <PlusIcon width={16} height={16} />
                  )}
                  Add
                </button>
              </form>

              {tasks.length === 0 ? (
                <EmptyState title="No tasks yet." />
              ) : (
                <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
                  {tasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      members={members}
                      onChange={(patch) => mutate(() => api.updateTask(job.id, task.id, patch))}
                    />
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Work log">
              <form
                className="mb-4 space-y-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!logBody.trim()) return;
                  setSavingLog(true);
                  await mutate(() =>
                    api.addWorkLog(job.id, {
                      kind: logKind,
                      body: logBody.trim(),
                      minutes: logMinutes ? Number(logMinutes) : null,
                    }),
                  );
                  setLogBody('');
                  setLogMinutes('');
                  setSavingLog(false);
                }}
              >
                <textarea
                  value={logBody}
                  onChange={(e) => setLogBody(e.target.value)}
                  rows={3}
                  placeholder="What was done on site?"
                  aria-label="Work log entry"
                  className={inputClass}
                />
                <div className="flex flex-wrap gap-2">
                  <select
                    value={logKind}
                    onChange={(e) => setLogKind(e.target.value as WorkLogKind)}
                    aria-label="Entry type"
                    className={`sm:w-40 ${inputClass}`}
                  >
                    {(Object.keys(WORK_LOG_KIND_LABELS) as WorkLogKind[]).map((k) => (
                      <option key={k} value={k}>
                        {WORK_LOG_KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={0}
                    max={1440}
                    value={logMinutes}
                    onChange={(e) => setLogMinutes(e.target.value)}
                    placeholder="Minutes"
                    aria-label="Minutes spent"
                    className={`sm:w-32 ${inputClass}`}
                  />
                  <button
                    type="submit"
                    disabled={savingLog || !logBody.trim()}
                    className="ml-auto flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:opacity-50"
                  >
                    {savingLog && <SpinnerIcon className="animate-spin" width={16} height={16} />}
                    Log it
                  </button>
                </div>
              </form>

              {workLogs.length === 0 ? (
                <EmptyState title="Nothing logged yet." />
              ) : (
                <ul className="space-y-3">
                  {workLogs.map((log) => (
                    <li key={log.id} className="rounded-lg border border-line bg-paper-100/50 p-4">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
                        <span className="font-medium text-ink-700">{displayName(log.author)}</span>
                        <span>· {WORK_LOG_KIND_LABELS[log.kind]}</span>
                        {log.minutes != null && <span>· {formatMinutes(log.minutes)}</span>}
                        <span title={new Date(log.occurredAt).toLocaleString()}>
                          · {timeAgo(log.occurredAt)}
                        </span>
                        {log.edited && <span className="text-caution-600">· edited</span>}
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm text-ink-800">{log.body}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        )}

        {tab === 'Crew' && (
          <Card title="Crew on this job">
            <form
              className="mb-4 flex flex-wrap gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!crewId) return;
                await mutate(() => api.assignAgent(job.id, crewId));
                setCrewId('');
              }}
            >
              <select
                value={crewId}
                onChange={(e) => setCrewId(e.target.value)}
                aria-label="Add someone to the crew"
                className={`sm:max-w-xs ${inputClass}`}
              >
                <option value="">Choose a team member…</option>
                {unassigned.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.fullName || m.email}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={!crewId}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:opacity-50"
              >
                Add to crew
              </button>
            </form>

            {crew.length === 0 ? (
              <EmptyState title="Nobody assigned yet." />
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
                {crew.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-600/30 text-xs font-semibold uppercase text-brand-200">
                      {displayName(c.agent, '?').slice(0, 2)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm ${c.active ? 'text-ink-900' : 'text-ink-500'}`}>
                        {displayName(c.agent)}
                      </p>
                      <p className="text-xs text-ink-500">
                        {ASSIGNMENT_ROLE_LABELS[c.roleOnJob]} · joined {timeAgo(c.assignedAt)}
                        {c.releasedAt && ` · released ${timeAgo(c.releasedAt)}`}
                      </p>
                    </div>
                    {c.active ? (
                      <button
                        onClick={() => mutate(() => api.releaseAgent(job.id, c.id))}
                        className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:bg-paper-200"
                      >
                        Release
                      </button>
                    ) : (
                      <span className="rounded-full border border-line px-2.5 py-1 text-xs text-ink-500">
                        Released
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-ink-500">
              Released crew stay on this list. Who was on the job during any past week is part of
              the record.
            </p>
          </Card>
        )}

        {tab === 'History' && (
          <Card title="Everything that has happened to this job">
            <MemoryFeed
              events={memory}
              showJob={false}
              emptyLabel="Nothing recorded for this job yet."
            />
            {memory.length >= 100 && (
              <p className="mt-3 text-xs text-ink-500">
                Showing the 100 most recent entries. The full history is in the memory export.
              </p>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
