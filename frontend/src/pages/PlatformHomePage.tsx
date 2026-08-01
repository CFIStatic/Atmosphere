import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  api,
  timeAgo,
  type AuditRun,
  type AuditStats,
  type BillingOverview,
  type CrmAccount,
  type Escalation,
  type JobSummary,
  type PmOverview,
} from '../lib/api';
import { AppShell } from '../components/AppShell';
import { AtmosphereRail } from '../components/AtmosphereRail';
import { displayName } from '../lib/display';
import { formatUsd } from '../lib/money';
import { METRIC_LABELS, PLATFORMS, type MetricKey, type PlatformId } from '../lib/platforms';
import { AlertIcon } from '../components/icons';

const OPEN_STATUSES = new Set(['draft', 'scheduled', 'in_progress', 'on_hold']);

/** Whole dollars, compact over $100k — the tiles are a glance, not a ledger. */
function dollars(amount: number): string {
  if (Math.abs(amount) >= 100_000) {
    return `$${(amount / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 })}k`;
  }
  return `$${amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

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
 * One home screen, four platforms.
 *
 * The layout is deliberately identical everywhere — six metrics, the work
 * that needs attention, what the agents did, and the Atmosphere rail — because
 * the products are the same console doing different jobs. What changes is
 * which six metrics are worth a manager's glance versus a technician's, and
 * which work each platform considers "needs attention".
 */
export function PlatformHomePage({ platform: platformId }: { platform: PlatformId }) {
  const platform = PLATFORMS[platformId];
  const { user, profile } = useAuth();

  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [pm, setPm] = useState<PmOverview | null>(null);
  const [stats, setStats] = useState<AuditStats | null>(null);
  const [runs, setRuns] = useState<AuditRun[] | null>(null);
  const [escalations, setEscalations] = useState<Escalation[] | null>(null);
  const [billing, setBilling] = useState<BillingOverview | null>(null);
  const [accounts, setAccounts] = useState<CrmAccount[] | null>(null);

  const loadEscalations = useCallback(() => {
    api
      .getEscalations()
      .then(({ escalations }) => setEscalations(escalations.filter((e) => e.status === 'open')))
      .catch(() => setEscalations([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const ok = <T,>(set: (v: T) => void, fallback: T) => ({
      then: (v: T) => !cancelled && set(v),
      catch: () => !cancelled && set(fallback),
    });

    api.getJobs({ status: 'all' }).then(({ jobs }) => !cancelled && setJobs(jobs)).catch(() => !cancelled && setJobs([]));
    api.pmOverview().then((o) => !cancelled && setPm(o)).catch(() => !cancelled && setPm(null));
    api.auditStats().then(({ stats }) => !cancelled && setStats(stats)).catch(() => !cancelled && setStats(null));
    api.auditRuns({ limit: 8 }).then(({ runs }) => !cancelled && setRuns(runs)).catch(() => !cancelled && setRuns([]));
    loadEscalations();
    void ok;

    // Only the platforms whose tiles need them pay for these calls.
    if (platform.metrics.some((m) => m === 'creditBalance' || m === 'usageThisPeriod')) {
      api.getBillingOverview().then((o) => !cancelled && setBilling(o)).catch(() => !cancelled && setBilling(null));
    }
    if (platform.metrics.includes('accounts')) {
      api.crmAccounts().then(({ items }) => !cancelled && setAccounts(items)).catch(() => !cancelled && setAccounts([]));
    }

    return () => {
      cancelled = true;
    };
  }, [loadEscalations, platform.metrics]);

  const firstName = displayName(profile?.fullName, user?.email).split(/[\s@]/)[0];
  const open = useMemo(() => (jobs ?? []).filter((j) => OPEN_STATUSES.has(j.status)), [jobs]);

  const metricValue = (key: MetricKey): { value: string; sub: string } => {
    const { hint } = METRIC_LABELS[key];
    switch (key) {
      case 'openJobs':
        return { value: jobs ? String(open.length) : '—', sub: hint };
      case 'blockedJobs':
        return { value: jobs ? String(open.filter((j) => j.status === 'on_hold').length) : '—', sub: hint };
      case 'atRiskProjects':
        return {
          value: pm
            ? String(pm.projects.filter((p) => p.health.band !== 'good').length)
            : '—',
          sub: hint,
        };
      case 'revenueInProgress':
        return { value: jobs ? dollars(open.reduce((s, j) => s + (j.contractAmount ?? 0), 0)) : '—', sub: hint };
      case 'receivablesOpen':
        return {
          value: jobs
            ? dollars((jobs ?? []).reduce((s, j) => s + Math.max(0, (j.invoicedAmount ?? 0) - (j.paidAmount ?? 0)), 0))
            : '—',
          sub: hint,
        };
      case 'collectedThisPeriod':
        return { value: jobs ? dollars((jobs ?? []).reduce((s, j) => s + (j.paidAmount ?? 0), 0)) : '—', sub: hint };
      case 'avgDaysDrying': {
        const drying = pm?.projects.filter((p) => p.drying) ?? [];
        return {
          value: drying.length
            ? (drying.reduce((s, p) => s + (p.drying?.daysDrying ?? 0), 0) / drying.length).toFixed(1)
            : '—',
          sub: drying.length ? `${drying.length} drying now` : hint,
        };
      }
      case 'agentActions24h':
        return { value: stats ? String(stats.runs24h) : '—', sub: stats ? `${stats.activeRuns} running now` : hint };
      case 'verifierPassRate': {
        const total = stats ? stats.succeededRuns + stats.failedRuns : 0;
        return {
          value: stats && total > 0 ? `${Math.round((stats.succeededRuns / total) * 100)}%` : '—',
          sub: hint,
        };
      }
      case 'awaitingApproval':
        return { value: escalations ? String(escalations.length) : '—', sub: hint };
      case 'crewOnJobs':
        return { value: jobs ? String(open.reduce((s, j) => s + j.crewSize, 0)) : '—', sub: hint };
      case 'accounts':
        return { value: accounts ? String(accounts.length) : '—', sub: hint };
      case 'scheduledToday':
        return { value: jobs ? String(open.filter((j) => isToday(j.scheduledStart)).length) : '—', sub: hint };
      case 'unscheduled':
        return { value: jobs ? String(open.filter((j) => !j.scheduledStart).length) : '—', sub: hint };
      case 'creditBalance':
        return { value: billing ? formatUsd(billing.balance.totalNanos) : '—', sub: hint };
      case 'usageThisPeriod':
        return { value: billing ? formatUsd(billing.periodUsage.priceNanos) : '—', sub: hint };
    }
  };

  /** Each platform ranks "needs attention" by what it is responsible for. */
  const attention = useMemo(() => {
    const list = [...open];
    if (platformId === 'manager') {
      return list
        .filter((j) => (j.invoicedAmount ?? 0) > (j.paidAmount ?? 0) || (j.contractAmount ?? 0) > 0)
        .sort(
          (a, b) =>
            Math.max(0, (b.invoicedAmount ?? 0) - (b.paidAmount ?? 0)) -
            Math.max(0, (a.invoicedAmount ?? 0) - (a.paidAmount ?? 0)),
        )
        .slice(0, 5);
    }
    if (platformId === 'field') {
      return list
        .sort((a, b) => {
          const at = a.scheduledStart ? Date.parse(a.scheduledStart) : Number.MAX_SAFE_INTEGER;
          const bt = b.scheduledStart ? Date.parse(b.scheduledStart) : Number.MAX_SAFE_INTEGER;
          return at - bt;
        })
        .slice(0, 5);
    }
    if (platformId === 'sales') {
      return list
        .filter((j) => j.status === 'draft' || j.status === 'scheduled')
        .concat(list.filter((j) => j.status === 'in_progress'))
        .slice(0, 5);
    }
    return list
      .sort((a, b) => {
        const ab = a.status === 'on_hold' ? 0 : 1;
        const bb = b.status === 'on_hold' ? 0 : 1;
        return ab - bb || a.priority - b.priority;
      })
      .slice(0, 5);
  }, [open, platformId]);

  const ATTENTION_TITLE: Record<PlatformId, string> = {
    sales: 'Work to win',
    operations: 'Needs attention',
    field: 'Next on site',
    manager: 'Money in play',
  };

  return (
    <AppShell
      rail={
        <AtmosphereRail
          context={platform.name}
          alerts={pm?.alerts ?? []}
          escalations={escalations}
          onResolved={loadEscalations}
        />
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-brand-600">{platform.name}</p>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-ink-900">
            Good to see you, {firstName}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-600">{platform.homeBlurb}</p>
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

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {platform.metrics.map((key) => {
          const { value, sub } = metricValue(key);
          return <Kpi key={key} label={METRIC_LABELS[key].label} value={value} sub={sub} />;
        })}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-5">
        <section className="rounded-xl glass-card lg:col-span-3">
          <header className="flex items-baseline justify-between border-b border-line px-5 py-4">
            <div>
              <h2 className="text-[15px] font-semibold text-ink-900">{ATTENTION_TITLE[platformId]}</h2>
              <p className="mt-0.5 text-xs text-ink-500">
                {jobs ? `${attention.length} of ${open.length} active jobs` : 'Loading…'}
              </p>
            </div>
            <Link to="/jobs" className="text-xs font-medium text-brand-600 hover:text-brand-700">
              All jobs
            </Link>
          </header>
          <div>
            {attention.map((job) => (
              <AttentionRow key={job.jobId} job={job} platform={platformId} />
            ))}
            {jobs && attention.length === 0 && (
              <p className="px-5 py-8 text-sm text-ink-500">Nothing here right now.</p>
            )}
          </div>
        </section>

        <section className="rounded-xl glass-card lg:col-span-2">
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

function AttentionRow({ job, platform }: { job: JobSummary; platform: PlatformId }) {
  const blocked = job.status === 'on_hold';
  const critical = job.priority === 1;
  const outstanding = Math.max(0, (job.invoicedAmount ?? 0) - (job.paidAmount ?? 0));

  // What the row's right column shows is what that platform is judged on.
  const right =
    platform === 'manager'
      ? { top: outstanding > 0 ? dollars(outstanding) : '—', bottom: 'outstanding' }
      : platform === 'field'
        ? {
            top: job.scheduledStart
              ? new Date(job.scheduledStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              : 'Unscheduled',
            bottom: `${job.crewSize} on crew`,
          }
        : {
            top: job.contractAmount != null ? dollars(job.contractAmount) : '—',
            bottom: `day ${Math.max(1, Math.round((Date.now() - Date.parse(job.createdAt)) / 86_400_000))}`,
          };

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
        <p className="text-sm font-semibold tabular-nums text-ink-900">{right.top}</p>
        <p className="mt-0.5 text-xs text-ink-500">{right.bottom}</p>
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
