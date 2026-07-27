import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  api,
  ApiError,
  PM_PHASE_LABELS,
  type PmAlert,
  type PmBrief,
  type PmEngineResult,
  type PmOverview,
  type PmProjectSummary,
} from '../lib/api';
import { AppShell } from '../components/AppShell';
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

type Tab = 'alerts' | 'projects' | 'crew';

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
      <div className="cx-aurora grid min-h-screen place-items-center bg-ink-900 text-brand-300">
        <SpinnerIcon className="animate-spin" width={28} height={28} />
      </div>
    );
  }

  return (
    <AppShell>
      <div className="cx-aurora min-h-screen">
      <header className="flex items-center justify-between border-b border-white/10 px-6 py-4 sm:px-10">
        <h1 className="text-lg font-semibold text-white">Project Manager</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void runEngine()}
            disabled={running}
            className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-500 disabled:opacity-60"
          >
            {running && <SpinnerIcon className="animate-spin" width={16} height={16} />}
            {running ? 'Checking…' : 'Re-check everything'}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8 sm:px-10">
        {error && (
          <div className="mb-6 rounded-lg border border-white/10 bg-ink-800/80 px-4 py-3 text-sm text-gray-200">
            {error}
          </div>
        )}

        <div className="animate-fade-in-up">
          <p className="text-sm font-medium text-brand-400">{membership?.org?.name}</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-white">
            {greeting()}, {shortName(user?.email)}
          </h1>
          <p className="mt-2 max-w-2xl text-gray-400">
            {data && data.counts.critical > 0
              ? `${data.counts.critical} thing${data.counts.critical === 1 ? '' : 's'} need${data.counts.critical === 1 ? 's' : ''} you first.`
              : data && data.counts.warn > 0
                ? `${data.counts.warn} item${data.counts.warn === 1 ? '' : 's'} to look at.`
                : 'Nothing flagged across your board.'}
          </p>

          {lastRun && (
            <p className="mt-2 text-xs text-gray-500">
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
                label="Ready to invoice"
                value={data.projects.filter((p) => p.documentation.invoiceReady).length}
                tone="good"
                hint="Paperwork complete"
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
                className="rounded-lg border border-white/10 bg-ink-700/70 px-3 py-1.5 text-xs text-gray-300 transition hover:bg-ink-600 disabled:opacity-60"
              >
                {briefLoading ? 'Writing…' : brief ? 'Rewrite' : 'Write it'}
              </button>
            }
          >
            {brief ? (
              <div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-200">
                  {brief.body}
                </p>
                <p className="mt-3 text-xs text-gray-500">
                  {brief.modelId
                    ? `Written by ${brief.modelId} from the facts the engine gathered.`
                    : 'Assembled from the facts the engine gathered. No model is configured, so this is the plain version.'}
                </p>
              </div>
            ) : (
              <p className="text-sm text-gray-500">
                A short read of where everything stands, built from the same checks that fill the
                alert list.
              </p>
            )}
          </Card>

          {/* Tabs */}
          <div className="mt-8 flex gap-1 border-b border-white/10">
            {(
              [
                ['alerts', `Needs attention (${openAlerts.length})`],
                ['projects', `Projects (${data?.counts.projects ?? 0})`],
                ['crew', `Crew (${data?.crew.length ?? 0})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition ${
                  tab === key
                    ? 'border-brand-500 text-white'
                    : 'border-transparent text-gray-400 hover:text-gray-200'
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

          {tab === 'projects' && (
            <div className="mt-5">
              <label className="mb-3 flex items-center gap-2 text-sm text-gray-400">
                <input
                  type="checkbox"
                  checked={onlyMine}
                  onChange={(e) => setOnlyMine(e.target.checked)}
                  className="h-4 w-4 rounded border-white/20 bg-ink-700"
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
                        <p className="text-sm font-medium text-white">
                          {c.fullName ?? c.email ?? c.userId.slice(0, 8)}
                        </p>
                        <p className="mt-0.5 text-xs text-gray-500">
                          {c.projectNumbers.join(', ') || 'No projects'}
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="text-xs text-gray-500">Projects</p>
                          <p className="text-lg font-semibold tabular-nums text-white">
                            {c.projectCount}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-gray-500">Open tasks</p>
                          <p className="text-lg font-semibold tabular-nums text-white">
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
    </AppShell>
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
    <article className="rounded-xl border border-white/10 bg-ink-800/60 p-4 backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <SeverityTag severity={alert.severity} />
            {alert.project && (
              <button
                onClick={() => navigate(`/pm/projects/${alert.project!.id}`)}
                className="text-xs text-brand-300 underline-offset-2 hover:underline"
              >
                {alert.project.projectNumber}
              </button>
            )}
            {alert.occurrences > 1 && (
              <span className="text-xs text-gray-500">seen {alert.occurrences}×</span>
            )}
          </div>
          <h3 className="mt-1.5 text-sm font-medium text-white">{alert.title}</h3>
          {alert.detail && <p className="mt-1 text-sm text-gray-400">{alert.detail}</p>}
          {alert.suggestedAction && (
            <p className="mt-2 text-sm text-brand-200">→ {alert.suggestedAction}</p>
          )}
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button
            onClick={() => onAct(alert, 'acknowledged')}
            className="rounded-lg border border-white/10 bg-ink-700/70 px-2.5 py-1.5 text-xs text-gray-300 transition hover:bg-ink-600"
            title="Keep it on the list, stop it shouting"
          >
            Seen
          </button>
          <button
            onClick={() => onAct(alert, 'snoozed', 24)}
            className="rounded-lg border border-white/10 bg-ink-700/70 px-2.5 py-1.5 text-xs text-gray-300 transition hover:bg-ink-600"
          >
            Tomorrow
          </button>
          <button
            onClick={() => onAct(alert, 'resolved')}
            className="rounded-lg border border-white/10 bg-ink-700/70 px-2.5 py-1.5 text-xs text-gray-300 transition hover:bg-ink-600"
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
      className="block rounded-xl border border-white/10 bg-ink-800/60 p-4 backdrop-blur transition hover:border-white/20 hover:bg-ink-800/80"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-brand-300">{p.projectNumber}</span>
            <Pill>{PM_PHASE_LABELS[p.phase]}</Pill>
            {p.status !== 'active' && <Pill>{p.status.replace('_', ' ')}</Pill>}
          </div>
          <h3 className="mt-1.5 truncate text-sm font-medium text-white">{p.name}</h3>
          <p className="mt-0.5 truncate text-xs text-gray-500">
            {[p.customerName, p.addressLine1, p.city].filter(Boolean).join(' · ') || 'No address'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          {summary.drying && (
            <div className="text-right">
              <p className="text-xs text-gray-500">Drying</p>
              <p className="text-sm tabular-nums text-gray-200">
                {summary.drying.areasAtGoal}/{summary.drying.openAreas} at goal
              </p>
            </div>
          )}
          <div className="text-right">
            <p className="text-xs text-gray-500">Open tasks</p>
            <p className="text-sm tabular-nums text-gray-200">
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
        <p className="mt-3 text-xs text-gray-500">{summary.health.reasons[0]!.text}</p>
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
