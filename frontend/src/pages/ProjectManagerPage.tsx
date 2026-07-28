import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  api,
  ApiError,
  PM_PHASE_LABELS,
  type PmAlert,
  type PmApproval,
  type PmBrief,
  type PmCommunication,
  type PmEngineResult,
  type PmOverview,
  type PmPlatformConnection,
  type PmProcurementRequest,
  type PmProjectSummary,
} from '../lib/api';
import { Logo } from '../components/Logo';
import { SpinnerIcon } from '../components/icons';
import {
  Card,
  EmptyState,
  HealthPill,
  Meter,
  Pill,
  SeverityTag,
  StatTile,
} from '../components/pm/primitives';

/**
 * The Project Manager cockpit.
 *
 * Ordered the way a morning goes: what is wrong, what has to happen today, then
 * everything else. The alert list is the centre of the screen because it is the
 * part a PM cannot reconstruct for themselves — the rest of the page they could
 * work out by opening every job in turn, which is exactly the half hour this is
 * meant to give back.
 */

type Tab = 'alerts' | 'approvals' | 'inbox' | 'procurement' | 'platforms' | 'projects' | 'crew';

export function ProjectManagerPage() {
  const { user, membership } = useAuth();
  const navigate = useNavigate();

  const [data, setData] = useState<PmOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('alerts');
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<PmEngineResult | null>(null);
  const [brief, setBrief] = useState<PmBrief | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const [approvals, setApprovals] = useState<PmApproval[]>([]);
  const [communications, setCommunications] = useState<PmCommunication[]>([]);
  const [procurement, setProcurement] = useState<PmProcurementRequest[]>([]);
  const [platforms, setPlatforms] = useState<{
    catalogue: { platform: string; label: string; description: string }[];
    connections: PmPlatformConnection[];
  } | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.pmOverview());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the project board.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (tab === 'approvals') {
      void api.pmApprovals().then((r) => setApprovals(r.approvals)).catch(() => undefined);
    } else if (tab === 'inbox') {
      void api
        .pmCommunications('new,reviewed')
        .then((r) => setCommunications(r.communications))
        .catch(() => undefined);
    } else if (tab === 'procurement') {
      void api.pmProcurement().then((r) => setProcurement(r.requests)).catch(() => undefined);
    } else if (tab === 'platforms') {
      void api.pmPlatforms().then(setPlatforms).catch(() => undefined);
    }
  }, [tab]);

  /**
   * Evaluate every rule now.
   *
   * Also runs quietly on first load below, so the board is never showing a
   * yesterday's-alerts view to someone who just opened the app.
   */
  const runEngine = useCallback(
    async (silent = false) => {
      if (!silent) setRunning(true);
      try {
        const { result } = await api.pmRun();
        if (!silent) setLastRun(result);
        await load();
      } catch (err) {
        if (!silent) {
          setError(err instanceof ApiError ? err.message : 'The automation pass failed.');
        }
      } finally {
        if (!silent) setRunning(false);
      }
    },
    [load],
  );

  useEffect(() => {
    // One pass on arrival. Cheap (a fixed number of queries), idempotent, and
    // it means the panel reflects this minute rather than the last visit.
    void runEngine(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadBrief(refresh = false) {
    setBriefLoading(true);
    try {
      const { brief: b } = await api.pmBrief(refresh);
      setBrief(b);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not build the brief.');
    } finally {
      setBriefLoading(false);
    }
  }

  async function actOnAlert(alert: PmAlert, status: string, snoozeHours?: number) {
    // Optimistic: the row leaves the list immediately. A failed write reloads
    // and puts it back, which is less jarring than a spinner on every row.
    setData((prev) =>
      prev ? { ...prev, alerts: prev.alerts.filter((a) => a.id !== alert.id) } : prev,
    );
    try {
      await api.pmAlertAction(alert.id, status, snoozeHours);
    } catch {
      await load();
    }
  }

  const visibleProjects = useMemo(() => {
    if (!data) return [];
    const list = onlyMine
      ? data.projects.filter((p) => p.project.pmUserId === user?.id)
      : data.projects;
    // Worst first — the board is a queue, not an index.
    return list.slice().sort((a, b) => a.health.score - b.health.score);
  }, [data, onlyMine, user?.id]);

  const openAlerts = useMemo(
    () => (data?.alerts ?? []).filter((a) => a.status === 'open' || a.status === 'acknowledged'),
    [data],
  );

  if (!data && !error) {
    return (
      <div className="cx-aurora grid min-h-screen place-items-center bg-paper-100 text-brand-600">
        <SpinnerIcon className="animate-spin" width={28} height={28} />
      </div>
    );
  }

  return (
    <div className="cx-aurora min-h-screen bg-paper-100">
      <header className="flex items-center justify-between border-b border-line px-6 py-4 sm:px-10">
        <div className="flex items-center gap-4">
          <Logo />
          <span className="hidden text-sm text-ink-500 sm:inline">Project Manager</span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/dashboard"
            className="rounded-lg border border-line bg-paper-0 px-3 py-2 text-sm text-ink-700 transition hover:bg-paper-100"
          >
            Dashboard
          </Link>
          <button
            onClick={() => void runEngine()}
            disabled={running}
            className="flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-ink-900 transition hover:bg-brand-500 disabled:opacity-60"
          >
            {running && <SpinnerIcon className="animate-spin" width={16} height={16} />}
            {running ? 'Checking…' : 'Re-check everything'}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8 sm:px-10">
        {error && (
          <div className="mb-6 rounded-lg border border-line bg-paper-0 px-4 py-3 text-sm text-ink-800">
            {error}
          </div>
        )}

        <div className="animate-fade-in-up">
          <p className="text-sm font-medium text-brand-600">{membership?.org?.name}</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-ink-900">
            {greeting()}, {shortName(user?.email)}
          </h1>
          <p className="mt-2 max-w-2xl text-ink-600">
            {data && data.counts.critical > 0
              ? `${data.counts.critical} thing${data.counts.critical === 1 ? '' : 's'} need${data.counts.critical === 1 ? 's' : ''} you first.`
              : data && data.counts.warn > 0
                ? `${data.counts.warn} item${data.counts.warn === 1 ? '' : 's'} to look at.`
                : 'Nothing flagged across your board.'}
          </p>

          {lastRun && (
            <p className="mt-2 text-xs text-ink-500">
              Checked {lastRun.projectsEvaluated} project(s) against {lastRun.rulesEvaluated} rules
              in {lastRun.durationMs}ms — {lastRun.alertsOpened} new, {lastRun.alertsCleared}{' '}
              cleared
              {lastRun.tasksCreated ? `, ${lastRun.tasksCreated} task(s) created` : ''}.
            </p>
          )}

          {/* Stat row */}
          {data && (
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile
                label="Needs you now"
                value={data.counts.critical}
                tone={data.counts.critical > 0 ? 'critical' : 'good'}
                hint={data.counts.critical > 0 ? 'Critical alerts' : 'Nothing critical'}
              />
              <StatTile
                label="Worth a look"
                value={data.counts.warn}
                tone={data.counts.warn > 0 ? 'warning' : 'good'}
                hint="Warnings"
              />
              <StatTile label="Open projects" value={data.counts.projects} hint={`${data.counts.mine} assigned to you`} />
              <StatTile
                label="Waiting on you"
                value={
                  (data.counts.pendingApprovals ?? 0) +
                  (data.counts.unreviewedComms ?? 0)
                }
                tone={
                  (data.counts.pendingApprovals ?? 0) > 0 ? 'warning' : 'good'
                }
                hint={`${data.counts.pendingApprovals ?? 0} approvals · ${data.counts.unreviewedComms ?? 0} messages`}
              />
            </div>
          )}

          {/* Brief */}
          <Card
            className="mt-6"
            title="Your brief"
            action={
              <button
                onClick={() => void loadBrief(Boolean(brief))}
                disabled={briefLoading}
                className="rounded-lg border border-line bg-paper-0 px-3 py-1.5 text-xs text-ink-700 transition hover:bg-paper-100 disabled:opacity-60"
              >
                {briefLoading ? 'Writing…' : brief ? 'Rewrite' : 'Write it'}
              </button>
            }
          >
            {brief ? (
              <div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-800">
                  {brief.body}
                </p>
                <p className="mt-3 text-xs text-ink-500">
                  {brief.modelId
                    ? `Written by ${brief.modelId} from the facts the engine gathered.`
                    : 'Assembled from the facts the engine gathered. No model is configured, so this is the plain version.'}
                </p>
              </div>
            ) : (
              <p className="text-sm text-ink-500">
                A short read of where everything stands, built from the same checks that fill the
                alert list.
              </p>
            )}
          </Card>

          {/* Tabs */}
          <div className="mt-8 flex flex-wrap gap-1 border-b border-line">
            {(
              [
                ['alerts', `Needs attention (${openAlerts.length})`],
                [
                  'approvals',
                  `Approvals (${data?.counts.pendingApprovals ?? approvals.length})`,
                ],
                [
                  'inbox',
                  `Inbox (${data?.counts.unreviewedComms ?? communications.filter((c) => c.status === 'new').length})`,
                ],
                [
                  'procurement',
                  `Procurement (${data?.counts.openProcurement ?? procurement.length})`,
                ],
                ['platforms', 'Platforms'],
                ['projects', `Projects (${data?.counts.projects ?? 0})`],
                ['crew', `Crew (${data?.crew.length ?? 0})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition ${
                  tab === key
                    ? 'border-brand-500 text-ink-900'
                    : 'border-transparent text-ink-600 hover:text-ink-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'alerts' && (
            <div className="mt-5 space-y-3">
              {openAlerts.length === 0 ? (
                <Card>
                  <EmptyState>
                    Nothing outstanding. The board was last checked{' '}
                    {lastRun ? 'just now' : 'when you opened this page'}.
                  </EmptyState>
                </Card>
              ) : (
                openAlerts.map((alert) => (
                  <AlertRow key={alert.id} alert={alert} onAct={actOnAlert} navigate={navigate} />
                ))
              )}
            </div>
          )}

          {tab === 'approvals' && (
            <div className="mt-5 space-y-3">
              <p className="text-sm text-ink-600">
                Irreversible actions land here first — platform writes, bid accepts, material
                referral orders. You decide; Atmosphere executes only after that.
              </p>
              {approvals.length === 0 ? (
                <Card>
                  <EmptyState>No pending approvals.</EmptyState>
                </Card>
              ) : (
                approvals.map((a) => (
                  <Card key={a.id}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Pill>{a.platform || a.kind}</Pill>
                          <Pill>{a.priority}</Pill>
                        </div>
                        <h3 className="mt-2 text-base font-semibold text-ink-900">{a.title}</h3>
                        {a.detail && (
                          <p className="mt-1 whitespace-pre-wrap text-sm text-ink-600">{a.detail}</p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          className="rounded-lg border border-line bg-paper-0 px-3 py-1.5 text-xs text-ink-700 hover:bg-paper-100"
                          onClick={() =>
                            void api
                              .pmDecideApproval(a.id, 'rejected')
                              .then(() => setApprovals((prev) => prev.filter((x) => x.id !== a.id)))
                              .then(() => load())
                          }
                        >
                          Reject
                        </button>
                        <button
                          className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-ink-900 hover:bg-brand-500"
                          onClick={() =>
                            void api
                              .pmDecideApproval(a.id, 'approved')
                              .then(() => setApprovals((prev) => prev.filter((x) => x.id !== a.id)))
                              .then(() => load())
                          }
                        >
                          Approve
                        </button>
                      </div>
                    </div>
                  </Card>
                ))
              )}
            </div>
          )}

          {tab === 'inbox' && (
            <div className="mt-5 space-y-3">
              <p className="text-sm text-ink-600">
                Messages that mentioned <span className="font-medium text-ink-800">@atmosphere</span>{' '}
                in iMessage, WhatsApp, Signal or SMS — filed against the job when we can match one.
              </p>
              {communications.length === 0 ? (
                <Card>
                  <EmptyState>Inbox is clear.</EmptyState>
                </Card>
              ) : (
                communications.map((c) => (
                  <Card key={c.id}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Pill>{c.channel}</Pill>
                          <Pill>{c.counterpartyKind}</Pill>
                          <Pill>{c.status}</Pill>
                        </div>
                        <h3 className="mt-2 text-base font-semibold text-ink-900">
                          {c.counterpartyName || c.counterpartyHandle || 'Unknown'}
                        </h3>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-ink-700">
                          {c.mentionExcerpt || c.body}
                        </p>
                        <p className="mt-2 text-xs text-ink-500">
                          {new Date(c.occurredAt).toLocaleString()}
                        </p>
                      </div>
                      {c.status === 'new' && (
                        <button
                          className="rounded-lg border border-line bg-paper-0 px-3 py-1.5 text-xs text-ink-700 hover:bg-paper-100"
                          onClick={() =>
                            void api
                              .pmUpdateCommunication(c.id, { status: 'filed' })
                              .then(() =>
                                setCommunications((prev) => prev.filter((x) => x.id !== c.id)),
                              )
                              .then(() => load())
                          }
                        >
                          File it
                        </button>
                      )}
                    </div>
                  </Card>
                ))
              )}
            </div>
          )}

          {tab === 'procurement' && (
            <div className="mt-5 space-y-3">
              <p className="text-sm text-ink-600">
                Dumpster bids from the web, and building-material orders through Atmosphere referral
                links (Home Depot, Lowe&apos;s, …) so the company gets a cut.
              </p>
              {procurement.length === 0 ? (
                <Card>
                  <EmptyState>
                    No open procurement. Derive an equipment plan from an estimate on a project to
                    start dumpster bids or material referrals.
                  </EmptyState>
                </Card>
              ) : (
                procurement.map((p) => (
                  <Card key={p.id}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill>{p.kind}</Pill>
                      <Pill>{p.status.replace(/_/g, ' ')}</Pill>
                    </div>
                    <h3 className="mt-2 text-base font-semibold text-ink-900">{p.title}</h3>
                    {p.description && (
                      <p className="mt-1 text-sm text-ink-600">{p.description}</p>
                    )}
                    {p.referralUrl && (
                      <a
                        href={p.referralUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-block text-sm text-brand-700 underline"
                      >
                        Open Atmosphere referral link
                      </a>
                    )}
                    {p.projectId && (
                      <button
                        className="mt-3 text-xs text-ink-600 underline"
                        onClick={() => navigate(`/pm/projects/${p.projectId}`)}
                      >
                        Open project
                      </button>
                    )}
                  </Card>
                ))
              )}
            </div>
          )}

          {tab === 'platforms' && (
            <div className="mt-5 space-y-3">
              <p className="text-sm text-ink-600">
                Orchestrate work across Dash, XactAnalysis, Xactimate and Outlook. Atmosphere syncs
                status in; outbound writes wait in Approvals.
              </p>
              {(platforms?.catalogue ?? []).map((p) => {
                const conn = platforms?.connections.find((c) => c.platform === p.platform);
                return (
                  <Card key={p.platform}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-base font-semibold text-ink-900">{p.label}</h3>
                        <p className="mt-1 text-sm text-ink-600">{p.description}</p>
                        <p className="mt-2 text-xs text-ink-500">
                          {conn
                            ? `Status: ${conn.status}${conn.lastSyncedAt ? ` · last sync ${new Date(conn.lastSyncedAt).toLocaleString()}` : ''}`
                            : 'Not connected yet'}
                        </p>
                      </div>
                      {data?.canManage && (
                        <button
                          className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-ink-900"
                          onClick={() =>
                            void api
                              .pmConnectPlatform({ platform: p.platform })
                              .then(() => api.pmPlatforms())
                              .then(setPlatforms)
                          }
                        >
                          {conn?.status === 'connected' ? 'Reconnect' : 'Connect'}
                        </button>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {tab === 'projects' && (
            <div className="mt-5">
              <label className="mb-3 flex items-center gap-2 text-sm text-ink-600">
                <input
                  type="checkbox"
                  checked={onlyMine}
                  onChange={(e) => setOnlyMine(e.target.checked)}
                  className="h-4 w-4 rounded border-line bg-paper-0"
                />
                Only projects assigned to me
              </label>
              <div className="space-y-3">
                {visibleProjects.length === 0 ? (
                  <Card>
                    <EmptyState>No open projects.</EmptyState>
                  </Card>
                ) : (
                  visibleProjects.map((p) => <ProjectRow key={p.project.id} summary={p} />)
                )}
              </div>
            </div>
          )}

          {tab === 'crew' && (
            <div className="mt-5 space-y-3">
              {(data?.crew ?? []).length === 0 ? (
                <Card>
                  <EmptyState>Nobody is assigned to a project yet.</EmptyState>
                </Card>
              ) : (
                (data?.crew ?? []).map((c) => (
                  <Card key={c.userId}>
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-ink-900">
                          {c.fullName ?? c.email ?? c.userId.slice(0, 8)}
                        </p>
                        <p className="mt-0.5 text-xs text-ink-500">
                          {c.projectNumbers.join(', ') || 'No projects'}
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="text-xs text-ink-500">Projects</p>
                          <p className="text-lg font-semibold tabular-nums text-ink-900">
                            {c.projectCount}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-ink-500">Open tasks</p>
                          <p className="text-lg font-semibold tabular-nums text-ink-900">
                            {c.openTaskCount}
                          </p>
                        </div>
                        <div className="w-40">
                          <Meter
                            label="Allocation"
                            pct={c.allocationPct}
                            tone={c.allocationPct > 100 ? 'critical' : c.allocationPct > 85 ? 'warning' : 'brand'}
                          />
                        </div>
                      </div>
                    </div>
                  </Card>
                ))
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Rows
 * ------------------------------------------------------------------ */

function AlertRow({
  alert,
  onAct,
  navigate,
}: {
  alert: PmAlert;
  onAct: (a: PmAlert, status: string, snoozeHours?: number) => void;
  navigate: ReturnType<typeof useNavigate>;
}) {
  return (
    <article className="rounded-xl border border-line bg-paper-0 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <SeverityTag severity={alert.severity} />
            {alert.project && (
              <button
                onClick={() => navigate(`/pm/projects/${alert.project!.id}`)}
                className="text-xs text-brand-600 underline-offset-2 hover:underline"
              >
                {alert.project.projectNumber}
              </button>
            )}
            {alert.occurrences > 1 && (
              <span className="text-xs text-ink-500">seen {alert.occurrences}×</span>
            )}
          </div>
          <h3 className="mt-1.5 text-sm font-medium text-ink-900">{alert.title}</h3>
          {alert.detail && <p className="mt-1 text-sm text-ink-600">{alert.detail}</p>}
          {alert.suggestedAction && (
            <p className="mt-2 text-sm text-brand-700">→ {alert.suggestedAction}</p>
          )}
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button
            onClick={() => onAct(alert, 'acknowledged')}
            className="rounded-lg border border-line bg-paper-0 px-2.5 py-1.5 text-xs text-ink-700 transition hover:bg-paper-100"
            title="Keep it on the list, stop it shouting"
          >
            Seen
          </button>
          <button
            onClick={() => onAct(alert, 'snoozed', 24)}
            className="rounded-lg border border-line bg-paper-0 px-2.5 py-1.5 text-xs text-ink-700 transition hover:bg-paper-100"
          >
            Tomorrow
          </button>
          <button
            onClick={() => onAct(alert, 'resolved')}
            className="rounded-lg border border-line bg-paper-0 px-2.5 py-1.5 text-xs text-ink-700 transition hover:bg-paper-100"
            title="I have handled this"
          >
            Done
          </button>
        </div>
      </div>
    </article>
  );
}

function ProjectRow({ summary }: { summary: PmProjectSummary }) {
  const p = summary.project;
  return (
    <Link
      to={`/pm/projects/${p.id}`}
      className="block rounded-xl border border-line bg-paper-0 p-4 transition hover:border-line-strong hover:bg-paper-100"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-brand-600">{p.projectNumber}</span>
            <Pill>{PM_PHASE_LABELS[p.phase]}</Pill>
            {p.status !== 'active' && <Pill>{p.status.replace('_', ' ')}</Pill>}
          </div>
          <h3 className="mt-1.5 truncate text-sm font-medium text-ink-900">{p.name}</h3>
          <p className="mt-0.5 truncate text-xs text-ink-500">
            {[p.customerName, p.addressLine1, p.city].filter(Boolean).join(' · ') || 'No address'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          {summary.drying && (
            <div className="text-right">
              <p className="text-xs text-ink-500">Drying</p>
              <p className="text-sm tabular-nums text-ink-800">
                {summary.drying.areasAtGoal}/{summary.drying.openAreas} at goal
              </p>
            </div>
          )}
          <div className="text-right">
            <p className="text-xs text-ink-500">Open tasks</p>
            <p className="text-sm tabular-nums text-ink-800">
              {summary.openTasks}
              {summary.overdueTasks > 0 && (
                <span className="pm-warning"> · {summary.overdueTasks} late</span>
              )}
            </p>
          </div>
          <HealthPill health={summary.health} />
        </div>
      </div>

      {summary.health.reasons.length > 0 && (
        <p className="mt-3 text-xs text-ink-500">{summary.health.reasons[0]!.text}</p>
      )}
    </Link>
  );
}

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function shortName(email: string | null | undefined): string {
  if (!email) return 'there';
  const name = email.split('@')[0] ?? '';
  return name.charAt(0).toUpperCase() + name.slice(1);
}
