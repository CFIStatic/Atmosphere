import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  api,
  timeAgo,
  type Escalation,
  type JobSummary,
  type PmOverview,
} from '../lib/api';
import { AppShell, EmptyState, PageHeader, PanelSpinner } from '../components/AppShell';

const OPEN_STATUSES = new Set(['draft', 'scheduled', 'in_progress', 'on_hold']);

/**
 * My Work: the slice of the org that is yours — jobs you own, alerts on
 * projects you run, and decisions waiting on you. Assembled from the same
 * endpoints the shared screens use, filtered to the signed-in account.
 */
export function MyWorkPage() {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [pm, setPm] = useState<PmOverview | null>(null);
  const [escalations, setEscalations] = useState<Escalation[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getJobs({ mine: true }).then(({ jobs }) => !cancelled && setJobs(jobs)).catch(() => !cancelled && setJobs([]));
    api.pmOverview().then((o) => !cancelled && setPm(o)).catch(() => !cancelled && setPm(null));
    api
      .getEscalations()
      .then(({ escalations }) => !cancelled && setEscalations(escalations.filter((e) => e.status === 'open')))
      .catch(() => !cancelled && setEscalations([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const myOpenJobs = useMemo(
    () => (jobs ?? []).filter((j) => OPEN_STATUSES.has(j.status)),
    [jobs],
  );
  const myProjects = useMemo(
    () => (pm?.projects ?? []).filter((p) => p.project.pmUserId === user?.id),
    [pm, user],
  );
  const myProjectIds = useMemo(() => new Set(myProjects.map((p) => p.project.id)), [myProjects]);
  const myAlerts = useMemo(
    () => (pm?.alerts ?? []).filter((a) => a.projectId && myProjectIds.has(a.projectId)),
    [pm, myProjectIds],
  );

  const loading = jobs === null && pm === null;

  return (
    <AppShell>
      <PageHeader
        eyebrow="Operate"
        title="My Work"
        description="Jobs you own, alerts on your projects, and decisions waiting on you — the day, narrowed to what is yours."
      />

      {loading && <PanelSpinner label="Loading your work" />}

      {!loading && (
        <div className="space-y-6">
          {escalations && escalations.length > 0 && (
            <Link
              to="/approvals"
              className="flex items-center justify-between rounded-xl border border-caution-200 bg-caution-50 px-5 py-4 transition hover:border-caution-600"
            >
              <div>
                <p className="text-sm font-semibold text-ink-900">
                  {escalations.length} decision{escalations.length === 1 ? '' : 's'} waiting on you
                </p>
                <p className="mt-0.5 text-xs text-ink-600">{escalations[0].question}</p>
              </div>
              <span className="text-sm font-semibold text-caution-600">Review →</span>
            </Link>
          )}

          <section className="rounded-xl border border-line bg-paper-0 shadow-card">
            <header className="flex items-baseline justify-between border-b border-line px-5 py-4">
              <h2 className="text-[15px] font-semibold text-ink-900">Your jobs</h2>
              <span className="text-xs text-ink-500">{myOpenJobs.length} open</span>
            </header>
            {myOpenJobs.map((job) => (
              <Link
                key={job.jobId}
                to={`/jobs/${job.jobId}`}
                className="flex items-center gap-3 border-b border-line px-5 py-3.5 transition last:border-b-0 hover:bg-paper-200"
              >
                <span className="font-mono text-xs text-ink-500">#{job.jobNumber}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink-900">{job.title}</p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {job.tasksDone}/{job.taskCount} tasks · {job.crewSize} on crew
                    {job.lastEventAt ? ` · ${timeAgo(job.lastEventAt)}` : ''}
                  </p>
                </div>
                <span className="rounded-full bg-paper-200 px-2 py-0.5 text-[11px] font-medium text-ink-600">
                  {job.status.replace(/_/g, ' ')}
                </span>
              </Link>
            ))}
            {jobs !== null && myOpenJobs.length === 0 && (
              <p className="px-5 py-8 text-sm text-ink-500">
                No open jobs are assigned to you. The full board lives under{' '}
                <Link to="/jobs" className="text-brand-600">Jobs</Link>.
              </p>
            )}
          </section>

          <section className="rounded-xl border border-line bg-paper-0 shadow-card">
            <header className="flex items-baseline justify-between border-b border-line px-5 py-4">
              <h2 className="text-[15px] font-semibold text-ink-900">Alerts on your projects</h2>
              <Link to="/pm" className="text-xs font-medium text-brand-600">
                Workflow board
              </Link>
            </header>
            {myAlerts.map((alert) => (
              <div key={alert.id} className="border-b border-line px-5 py-3.5 last:border-b-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      alert.severity === 'critical'
                        ? 'bg-danger-50 text-danger-600'
                        : 'bg-caution-50 text-caution-600'
                    }`}
                  >
                    {alert.severity === 'critical' ? 'Critical' : 'Warning'}
                  </span>
                  <p className="text-sm font-semibold text-ink-900">{alert.title}</p>
                  {alert.project && (
                    <span className="ml-auto font-mono text-[11px] text-ink-500">
                      {alert.project.projectNumber}
                    </span>
                  )}
                </div>
                {alert.suggestedAction && (
                  <p className="mt-1 text-[13px] text-ink-600">{alert.suggestedAction}</p>
                )}
              </div>
            ))}
            {pm !== null && myAlerts.length === 0 && (
              <p className="px-5 py-8 text-sm text-ink-500">
                Nothing flagged on projects you run.
              </p>
            )}
          </section>

          {jobs !== null && pm === null && myOpenJobs.length === 0 && (
            <EmptyState
              title="Nothing assigned yet"
              hint="Work lands here once jobs are owned by you or projects list you as the PM."
            />
          )}
        </div>
      )}
    </AppShell>
  );
}
