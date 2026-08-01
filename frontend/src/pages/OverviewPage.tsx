import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  api,
  timeAgo,
  type AuditRun,
  type AuditStats,
  type Escalation,
  type JobSummary,
  type PmOverview,
} from '../lib/api';
import { AppShell } from '../components/AppShell';
import { displayName } from '../lib/display';
import { AlertIcon, ArrowUpIcon, SparkIcon, SpinnerIcon } from '../components/icons';

/* ------------------------------------------------------------------ money */

/** Whole dollars, compact over $100k — the tiles are a glance, not a ledger. */
function dollars(amount: number): string {
  if (Math.abs(amount) >= 100_000) {
    return `$${(amount / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 })}k`;
  }
  return `$${amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

const OPEN_STATUSES = new Set(['draft', 'scheduled', 'in_progress', 'on_hold']);

/* ------------------------------------------------------------------- page */

export function OverviewPage() {
  const { user, profile } = useAuth();

  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [pm, setPm] = useState<PmOverview | null>(null);
  const [stats, setStats] = useState<AuditStats | null>(null);
  const [runs, setRuns] = useState<AuditRun[] | null>(null);
  const [escalations, setEscalations] = useState<Escalation[] | null>(null);

  const loadEscalations = useCallback(() => {
    api
      .getEscalations()
      .then(({ escalations }) => setEscalations(escalations.filter((e) => e.status === 'open')))
      .catch(() => setEscalations([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Each panel fails to its own empty state — the overview never blanks
    // because one endpoint is unhappy.
    api.getJobs({ status: 'open' }).then(({ jobs }) => !cancelled && setJobs(jobs)).catch(() => !cancelled && setJobs([]));
    api.pmOverview().then((o) => !cancelled && setPm(o)).catch(() => !cancelled && setPm(null));
    api.auditStats().then(({ stats }) => !cancelled && setStats(stats)).catch(() => !cancelled && setStats(null));
    api.auditRuns({ limit: 8 }).then(({ runs }) => !cancelled && setRuns(runs)).catch(() => !cancelled && setRuns([]));
    loadEscalations();
    return () => {
      cancelled = true;
    };
  }, [loadEscalations]);

  const firstName = displayName(profile?.fullName, user?.email).split(/[\s@]/)[0];

  /* ---- KPIs, computed from what actually loaded ---- */
  const open = useMemo(() => (jobs ?? []).filter((j) => OPEN_STATUSES.has(j.status)), [jobs]);
  const blocked = open.filter((j) => j.status === 'on_hold').length;
  const atRisk = pm ? pm.projects.filter((p) => p.health.band === 'at_risk' || p.health.band === 'critical').length : 0;
  const revenue = open.reduce((sum, j) => sum + (j.contractAmount ?? 0), 0);
  const receivables = (jobs ?? []).reduce(
    (sum, j) => sum + Math.max(0, (j.invoicedAmount ?? 0) - (j.paidAmount ?? 0)),
    0,
  );
  const dryingProjects = pm?.projects.filter((p) => p.drying) ?? [];
  const avgDrying = dryingProjects.length
    ? dryingProjects.reduce((s, p) => s + (p.drying?.daysDrying ?? 0), 0) / dryingProjects.length
    : null;
  const passRate = stats && stats.succeededRuns + stats.failedRuns > 0
    ? Math.round((stats.succeededRuns / (stats.succeededRuns + stats.failedRuns)) * 100)
    : null;

  const attention = useMemo(() => {
    const ranked = [...open].sort((a, b) => {
      const aBlocked = a.status === 'on_hold' ? 0 : 1;
      const bBlocked = b.status === 'on_hold' ? 0 : 1;
      return aBlocked - bBlocked || a.priority - b.priority;
    });
    return ranked.slice(0, 5);
  }, [open]);

  return (
    <AppShell
      rail={
        <AtmosphereRail
          alerts={pm?.alerts ?? []}
          escalations={escalations}
          onResolved={loadEscalations}
        />
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">
            Good to see you, {firstName}
          </h1>
          <p className="mt-1 text-sm text-ink-600">
            Everything happening across your jobs right now.
          </p>
        </div>
        {escalations && escalations.length > 0 && (
          <Link
            to="/approvals"
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-400"
          >
            {escalations.length} awaiting approval →
          </Link>
        )}
      </div>

      {/* ---- KPI tiles ---- */}
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
        <Kpi
          label="Active jobs"
          value={jobs ? String(open.length) : '—'}
          sub={pm ? `${blocked} blocked, ${atRisk} at risk` : `${blocked} blocked`}
        />
        <Kpi
          label="Revenue in progress"
          value={jobs ? dollars(revenue) : '—'}
          sub="Approved scope on open jobs"
        />
        <Kpi
          label="Receivables open"
          value={jobs ? dollars(receivables) : '—'}
          sub="Invoiced, not yet paid"
        />
        <Kpi
          label="Avg. days drying"
          value={avgDrying !== null ? avgDrying.toFixed(1) : '—'}
          sub={dryingProjects.length ? `${dryingProjects.length} drying now` : 'No drying projects'}
        />
        <Kpi
          label="Agent actions (24h)"
          value={stats ? String(stats.runs24h) : '—'}
          sub={stats ? `${stats.activeRuns} running now` : ''}
        />
        <Kpi
          label="Verifier pass rate"
          value={passRate !== null ? `${passRate}%` : '—'}
          sub={stats ? `${stats.succeededRuns} runs confirmed` : ''}
        />
      </div>

      {/* ---- Needs attention + agent activity ---- */}
      <div className="mt-6 grid gap-4 lg:grid-cols-5">
        <section className="rounded-xl border border-line bg-paper-0 shadow-card lg:col-span-3">
          <header className="flex items-baseline justify-between border-b border-line px-5 py-4">
            <div>
              <h2 className="text-[15px] font-semibold text-ink-900">Needs attention</h2>
              <p className="mt-0.5 text-xs text-ink-500">
                {jobs ? `${attention.length} of ${open.length} active jobs ranked by urgency` : 'Loading…'}
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
              <p className="px-5 py-8 text-sm text-ink-500">Nothing on fire. Enjoy it.</p>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-line bg-paper-0 shadow-card lg:col-span-2">
          <header className="flex items-baseline justify-between border-b border-line px-5 py-4">
            <div>
              <h2 className="text-[15px] font-semibold text-ink-900">Agent activity</h2>
              <p className="mt-0.5 text-xs text-ink-500">What Atmosphere has been doing</p>
            </div>
            <Link to="/audit" className="text-xs font-medium text-brand-600 hover:text-brand-700">
              All agents
            </Link>
          </header>
          <div>
            {(runs ?? []).slice(0, 7).map((run) => (
              <ActivityRow key={run.id} run={run} />
            ))}
            {runs && runs.length === 0 && (
              <p className="px-5 py-8 text-sm text-ink-500">
                No agent runs yet — they land here the moment work starts.
              </p>
            )}
          </div>
        </section>
      </div>

    </AppShell>
  );
}

/* ------------------------------------------------------------- components */

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-paper-0 px-4 py-3.5 shadow-card">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">{label}</p>
      <p className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight text-ink-900">{value}</p>
      {sub && <p className="mt-1 truncate text-xs text-ink-500">{sub}</p>}
    </div>
  );
}

function jobChip(job: JobSummary): { label: string; cls: string } | null {
  if (job.status === 'on_hold') return { label: 'Blocked', cls: 'bg-danger-50 text-danger-600' };
  if (job.priority === 1) return { label: 'Critical', cls: 'bg-danger-50 text-danger-600' };
  if (job.priority === 2) return { label: 'At risk', cls: 'bg-caution-50 text-caution-600' };
  return null;
}

const PHASE_LABEL: Record<string, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  on_hold: 'On hold',
};

function AttentionRow({ job }: { job: JobSummary }) {
  const chip = jobChip(job);
  const days = Math.max(1, Math.round((Date.now() - Date.parse(job.createdAt)) / 86_400_000));
  return (
    <Link
      to={`/jobs/${job.jobId}`}
      className="flex items-start gap-3 border-b border-line px-5 py-3.5 transition last:border-b-0 hover:bg-paper-200"
    >
      <AlertIcon
        width={15}
        height={15}
        className={`mt-0.5 shrink-0 ${chip ? (chip.label === 'At risk' ? 'text-caution-600' : 'text-danger-600') : 'text-ink-500'}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-ink-500">#{job.jobNumber}</span>
          <span className="truncate text-sm font-semibold text-ink-900">{job.title}</span>
          {chip && (
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${chip.cls}`}>
              {chip.label}
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
          {job.contractAmount != null ? dollars(job.contractAmount) : ''}
        </p>
        <p className="mt-0.5 text-xs text-ink-500">day {days}</p>
      </div>
    </Link>
  );
}

const RUN_STATUS: Record<AuditRun['status'], { label: string; cls: string }> = {
  queued: { label: 'Queued', cls: 'text-ink-500' },
  running: { label: 'Running', cls: 'text-brand-600' },
  succeeded: { label: 'Succeeded', cls: 'text-success-600' },
  failed: { label: 'Failed', cls: 'text-danger-600' },
  cancelled: { label: 'Cancelled', cls: 'text-ink-500' },
};

function ActivityRow({ run }: { run: AuditRun }) {
  const s = RUN_STATUS[run.status];
  return (
    <Link
      to="/audit"
      className="block border-b border-line px-5 py-3 transition last:border-b-0 hover:bg-paper-200"
    >
      <p className="text-[13.5px] font-medium leading-snug text-ink-900">{run.title}</p>
      <p className="mt-1 text-xs text-ink-500">
        <span className={`font-semibold ${s.cls}`}>{s.label}</span>
        {' · '}
        {run.agent.name}
        {' · '}
        {timeAgo(run.startedAt ?? run.createdAt)}
      </p>
    </Link>
  );
}

/* ------------------------------------------------------------------- rail */

/**
 * The Atmosphere panel: what the agents recommend, what waits on a person,
 * and a place to ask. Its closing line is the product's contract — Atmosphere
 * proposes; you approve.
 */
function AtmosphereRail({
  alerts,
  escalations,
  onResolved,
}: {
  alerts: PmOverview['alerts'];
  escalations: Escalation[] | null;
  onResolved: () => void;
}) {
  const { membership } = useAuth();
  const [question, setQuestion] = useState('');
  const [reply, setReply] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);

  const first = escalations?.[0] ?? null;

  async function ask() {
    const q = question.trim();
    if (!q || asking) return;
    setAsking(true);
    setReply(null);
    try {
      const res = await api.assist(q, [], {
        role: membership?.role,
        workType: membership?.workType,
        orgName: membership?.org?.name,
      });
      setReply(res.reply);
    } catch {
      setReply('Could not reach the assistant — try again in a moment.');
    } finally {
      setAsking(false);
    }
  }

  async function resolve(escalationId: string, optionId: string) {
    setResolving(optionId);
    try {
      await api.resolveEscalation(escalationId, optionId);
      onResolved();
    } catch {
      /* the queue re-renders from the reload either way */
    } finally {
      setResolving(null);
    }
  }

  return (
    <div className="sticky top-[73px] rounded-xl border border-line bg-paper-50 shadow-card">
      <header className="flex items-center gap-2.5 border-b border-line px-4 py-3.5">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-500 text-white">
          <SparkIcon width={15} height={15} />
        </span>
        <div>
          <p className="text-sm font-semibold text-ink-900">Atmosphere</p>
          <p className="text-[11px] text-ink-500">Context: Overview</p>
        </div>
      </header>

      <div className="cx-scroll max-h-[calc(100vh-320px)] overflow-y-auto px-4 py-4">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-500">
          Recommended next
        </p>
        <div className="mt-2 space-y-2.5">
          {alerts.slice(0, 4).map((alert) => (
            <div key={alert.id} className="rounded-lg border border-line bg-paper-0 p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[13px] font-semibold leading-snug text-ink-900">{alert.title}</p>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
                    alert.severity === 'critical'
                      ? 'bg-danger-50 text-danger-600'
                      : 'bg-caution-50 text-caution-600'
                  }`}
                >
                  {alert.severity === 'critical' ? 'high' : 'medium'}
                </span>
              </div>
              {(alert.detail || alert.suggestedAction) && (
                <p className="mt-1 text-xs leading-relaxed text-ink-600">
                  {alert.detail ?? alert.suggestedAction}
                </p>
              )}
              {alert.project && (
                <p className="mt-1.5 font-mono text-[11px] text-brand-600">
                  {alert.project.projectNumber}
                </p>
              )}
            </div>
          ))}
          {alerts.length === 0 && (
            <p className="text-xs text-ink-500">
              Nothing flagged — the rules sweep every project on schedule.
            </p>
          )}
        </div>

        <div className="mt-5 flex items-baseline justify-between">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-500">
            Awaiting approval{escalations ? ` · ${escalations.length}` : ''}
          </p>
          <Link to="/approvals" className="text-[11px] font-medium text-brand-600">
            View all
          </Link>
        </div>
        <div className="mt-2">
          {first ? (
            <div className="rounded-lg border border-brand-300 bg-paper-0 p-3">
              <p className="text-[13px] font-semibold leading-snug text-ink-900">{first.question}</p>
              {first.context.verifierSummary && (
                <p className="mt-1 text-xs leading-relaxed text-ink-600">
                  {first.context.verifierSummary}
                </p>
              )}
              <div className="mt-2.5 space-y-1.5">
                {first.options.slice(0, 3).map((option) => (
                  <button
                    key={option.id}
                    onClick={() => resolve(first.id, option.id)}
                    disabled={resolving !== null}
                    className="w-full rounded-md border border-line px-2.5 py-1.5 text-left text-xs font-medium text-ink-800 transition hover:border-brand-500 hover:text-ink-900 disabled:opacity-50"
                  >
                    {resolving === option.id ? 'Working…' : option.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-ink-500">
              {escalations === null ? 'Loading…' : 'Nothing waiting on you.'}
            </p>
          )}
        </div>

        {reply && (
          <div className="mt-5 rounded-lg border border-line bg-paper-0 p-3">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-brand-600">
              Atmosphere
            </p>
            <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-800">
              {reply}
            </p>
          </div>
        )}
      </div>

      <div className="border-t border-line p-3">
        <div className="flex items-end gap-2 rounded-lg border border-line bg-paper-0 p-2 focus-within:border-brand-500">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void ask();
              }
            }}
            rows={2}
            placeholder="Ask Atmosphere to do something…"
            aria-label="Ask Atmosphere"
            className="w-full resize-none bg-transparent text-[13px] text-ink-900 placeholder-ink-500 outline-none"
          />
          <button
            onClick={() => void ask()}
            disabled={asking || !question.trim()}
            aria-label="Send"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-brand-500 text-white transition hover:bg-brand-400 disabled:opacity-40"
          >
            {asking ? (
              <SpinnerIcon className="animate-spin" width={14} height={14} />
            ) : (
              <ArrowUpIcon width={14} height={14} />
            )}
          </button>
        </div>
        <p className="mt-2 px-1 text-[11px] leading-relaxed text-ink-500">
          Atmosphere proposes; you approve. Nothing changes without sign-off.
        </p>
      </div>
    </div>
  );
}
